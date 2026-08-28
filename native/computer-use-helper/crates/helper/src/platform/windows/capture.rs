//! Exact-window capture validation and bounded PNG transfer.

use std::io::Write;

#[cfg(any(test, target_os = "windows"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::mpsc;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

use flate2::Compression;
use flate2::write::ZlibEncoder;

#[cfg(target_os = "windows")]
use computer_use_core::CancellationToken;

#[cfg(target_os = "windows")]
use windows::Foundation::TypedEventHandler;
#[cfg(target_os = "windows")]
use windows::Graphics::Capture::{
    Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
#[cfg(target_os = "windows")]
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
#[cfg(target_os = "windows")]
use windows::Graphics::DirectX::DirectXPixelFormat;
#[cfg(target_os = "windows")]
use windows::Graphics::SizeInt32;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HMODULE, HWND, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_FLAG_DO_NOT_WAIT,
    D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::{DXGI_ERROR_WAS_STILL_DRAWING, IDXGIAdapter, IDXGIDevice};
#[cfg(target_os = "windows")]
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
#[cfg(target_os = "windows")]
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
#[cfg(target_os = "windows")]
use windows::core::{IInspectable, Interface};

use super::identity::WindowIdentity;
#[cfg(target_os = "windows")]
use super::identity::query_window_identity;
use super::scale::PhysicalRect;

#[cfg(any(test, target_os = "windows"))]
const MAX_NATIVE_CAPTURE_WIDTH: u32 = 2_048;
#[cfg(any(test, target_os = "windows"))]
const MAX_NATIVE_CAPTURE_HEIGHT: u32 = 2_048;
#[cfg(any(test, target_os = "windows"))]
const MAX_NATIVE_CAPTURE_PIXELS: usize = 4_194_304;

#[cfg(target_os = "windows")]
static CAPTURE_WORKER: CaptureWorkerGate = CaptureWorkerGate::new();

#[cfg(any(test, target_os = "windows"))]
struct CaptureWorkerGate(AtomicBool);

#[cfg(any(test, target_os = "windows"))]
impl CaptureWorkerGate {
    const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    fn try_acquire(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn release(&self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CapturedFrame {
    pub(crate) identity: WindowIdentity,
    pub(crate) bounds: PhysicalRect,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) stride: usize,
    pub(crate) bgra: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CaptureLimits {
    pub(crate) max_width: u32,
    pub(crate) max_height: u32,
    pub(crate) max_pixels: usize,
    pub(crate) max_png_bytes: usize,
}

/// Capture one frame for the exact HWND that was approved by list/snapshot.
///
/// The caller owns WinRT initialization. This function binds the request to the
/// full HWND/PID/process-creation identity and physical bounds before and after
/// capture, and never allocates beyond the same 2048x2048 policy used by the
/// immutable PNG envelope.
#[cfg(target_os = "windows")]
pub(crate) fn capture_exact_window(
    hwnd: HWND,
    expected_identity: WindowIdentity,
    expected_bounds: PhysicalRect,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<CapturedFrame, &'static str> {
    if !CAPTURE_WORKER.try_acquire() {
        return Err("BUSY");
    }
    let worker_cancel = cancel.clone();
    let worker_epoch = *epoch;
    let worker_hwnd = hwnd.0 as usize;
    let (sender, receiver) = mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("dsh-windows-capture".to_owned())
        .spawn(move || {
            struct ReleaseCaptureWorker;
            impl Drop for ReleaseCaptureWorker {
                fn drop(&mut self) {
                    CAPTURE_WORKER.release();
                }
            }
            let _release = ReleaseCaptureWorker;
            let initialized = unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok();
            let result = if initialized {
                let hwnd = HWND(worker_hwnd as *mut _);
                capture_exact_window_on_worker(
                    hwnd,
                    expected_identity,
                    expected_bounds,
                    &worker_epoch,
                    deadline_ms,
                    &worker_cancel,
                )
            } else {
                Err("NOT_SUPPORTED")
            };
            if initialized {
                unsafe { RoUninitialize() };
            }
            let _ = sender.send(result);
        })
        .is_err()
    {
        CAPTURE_WORKER.release();
        return Err("INTERNAL");
    }

    loop {
        check_request(epoch, deadline_ms, cancel)?;
        let now_ms = u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        let wait_ms = deadline_ms.saturating_sub(now_ms).clamp(1, 10);
        match receiver.recv_timeout(Duration::from_millis(wait_ms)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("INTERNAL"),
        }
    }
}

#[cfg(target_os = "windows")]
fn capture_exact_window_on_worker(
    hwnd: HWND,
    expected_identity: WindowIdentity,
    expected_bounds: PhysicalRect,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<CapturedFrame, &'static str> {
    check_request(epoch, deadline_ms, cancel)?;
    validate_exact_target(hwnd, expected_identity, expected_bounds)?;
    bounded_dimensions(expected_bounds)?;

    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return Err("NOT_SUPPORTED");
    }
    let device = create_capture_device()?;
    check_request(epoch, deadline_ms, cancel)?;

    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|_| "NOT_SUPPORTED")?;
    let item: GraphicsCaptureItem =
        unsafe { interop.CreateForWindow(hwnd) }.map_err(|_| "TARGET_CLOSED")?;
    let item_size = item.Size().map_err(|_| "TARGET_CLOSED")?;
    let (width, height) =
        bounded_pixel_dimensions(i64::from(item_size.Width), i64::from(item_size.Height))?;

    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &device.winrt,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        1,
        item_size,
    )
    .map_err(|_| "NOT_SUPPORTED")?;
    let mut resources = CaptureResources {
        pool,
        session: None,
        frame_token: None,
    };
    let session = resources
        .pool
        .CreateCaptureSession(&item)
        .map_err(|_| "NOT_SUPPORTED")?;
    let _ = session.SetIsCursorCaptureEnabled(false);
    resources.session = Some(session);

    let (sender, receiver) = mpsc::sync_channel(1);
    let handler = TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
        move |_sender, _args| {
            let _ = sender.try_send(());
            Ok(())
        },
    );
    let frame_token = resources
        .pool
        .FrameArrived(&handler)
        .map_err(|_| "NOT_SUPPORTED")?;
    resources.frame_token = Some(frame_token);
    resources
        .session
        .as_ref()
        .ok_or("INTERNAL")?
        .StartCapture()
        .map_err(|_| "NOT_SUPPORTED")?;

    wait_for_frame_signal(&receiver, epoch, deadline_ms, cancel)?;
    check_request(epoch, deadline_ms, cancel)?;
    let frame = resources
        .pool
        .TryGetNextFrame()
        .map_err(|_| "BINARY_MISMATCH")?;
    let frame = CapturedWinRtFrame(frame);
    let content_size = frame.0.ContentSize().map_err(|_| "BINARY_MISMATCH")?;
    validate_frame_size(content_size, width, height)?;

    let surface = frame.0.Surface().map_err(|_| "BINARY_MISMATCH")?;
    let surface_access: IDirect3DDxgiInterfaceAccess =
        surface.cast().map_err(|_| "BINARY_MISMATCH")?;
    let source_texture: ID3D11Texture2D =
        unsafe { surface_access.GetInterface() }.map_err(|_| "BINARY_MISMATCH")?;
    let mut source_desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { source_texture.GetDesc(&mut source_desc) };
    if source_desc.Width != width
        || source_desc.Height != height
        || source_desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
        || source_desc.SampleDesc.Count != 1
    {
        return Err("BINARY_MISMATCH");
    }
    check_request(epoch, deadline_ms, cancel)?;

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
        ..source_desc
    };
    let mut staging = None;
    unsafe {
        device
            .native
            .CreateTexture2D(&staging_desc, None, Some(&mut staging))
    }
    .map_err(|_| "INTERNAL")?;
    let staging = staging.ok_or("INTERNAL")?;
    unsafe { device.context.CopyResource(&staging, &source_texture) };

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    loop {
        check_request(epoch, deadline_ms, cancel)?;
        match unsafe {
            device.context.Map(
                &staging,
                0,
                D3D11_MAP_READ,
                D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                Some(&mut mapped),
            )
        } {
            Ok(()) => break,
            Err(error) if error.code() == DXGI_ERROR_WAS_STILL_DRAWING => {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(_) => return Err("INTERNAL"),
        }
    }
    let mapped_guard = MappedTexture {
        context: &device.context,
        texture: &staging,
    };
    let row_pitch = usize::try_from(mapped.RowPitch).map_err(|_| "BINARY_MISMATCH")?;
    let mapped_len = row_pitch
        .checked_mul(usize::try_from(height).map_err(|_| "BINARY_MISMATCH")?)
        .ok_or("POLICY_DENIED")?;
    if mapped.pData.is_null() || mapped_len == 0 {
        return Err("BINARY_MISMATCH");
    }
    // SAFETY: Map succeeded for a staging texture, mapped_len is checked from
    // the driver RowPitch and the validated texture height, and `mapped_guard`
    // keeps the subresource mapped for the entire slice lifetime.
    let mapped_bytes = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), mapped_len) };
    let tight_row_bytes = usize::try_from(width)
        .ok()
        .and_then(|value| value.checked_mul(4))
        .ok_or("POLICY_DENIED")?;
    let bgra = copy_tight_bgra(mapped_bytes, row_pitch, tight_row_bytes, height)?;
    drop(mapped_guard);

    check_request(epoch, deadline_ms, cancel)?;
    validate_exact_target(hwnd, expected_identity, expected_bounds)?;
    Ok(CapturedFrame {
        identity: expected_identity,
        bounds: expected_bounds,
        width,
        height,
        stride: tight_row_bytes,
        bgra,
    })
}

#[cfg(any(test, target_os = "windows"))]
fn copy_tight_bgra(
    source: &[u8],
    row_pitch: usize,
    tight_row_bytes: usize,
    height: u32,
) -> Result<Vec<u8>, &'static str> {
    let height = usize::try_from(height).map_err(|_| "BINARY_MISMATCH")?;
    if row_pitch < tight_row_bytes || tight_row_bytes == 0 || height == 0 {
        return Err("BINARY_MISMATCH");
    }
    let source_len = row_pitch.checked_mul(height).ok_or("POLICY_DENIED")?;
    let output_len = tight_row_bytes.checked_mul(height).ok_or("POLICY_DENIED")?;
    if source.len() < source_len {
        return Err("BINARY_MISMATCH");
    }
    let mut output = Vec::with_capacity(output_len);
    for row in 0..height {
        let start = row.checked_mul(row_pitch).ok_or("POLICY_DENIED")?;
        let end = start.checked_add(tight_row_bytes).ok_or("POLICY_DENIED")?;
        output.extend_from_slice(source.get(start..end).ok_or("BINARY_MISMATCH")?);
    }
    Ok(output)
}

#[cfg(target_os = "windows")]
fn create_capture_device() -> Result<CaptureDevice, &'static str> {
    create_capture_device_for(D3D_DRIVER_TYPE_HARDWARE)
        .or_else(|_| create_capture_device_for(D3D_DRIVER_TYPE_WARP))
}

#[cfg(target_os = "windows")]
fn create_capture_device_for(driver_type: D3D_DRIVER_TYPE) -> Result<CaptureDevice, &'static str> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None::<&IDXGIAdapter>,
            driver_type,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|_| "NOT_SUPPORTED")?;
    let device = device.ok_or("NOT_SUPPORTED")?;
    let context = context.ok_or("NOT_SUPPORTED")?;
    let dxgi_device: IDXGIDevice = device.cast().map_err(|_| "NOT_SUPPORTED")?;
    let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }
        .map_err(|_| "NOT_SUPPORTED")?;
    let winrt_device: IDirect3DDevice = inspectable.cast().map_err(|_| "NOT_SUPPORTED")?;
    Ok(CaptureDevice {
        native: device,
        context,
        winrt: winrt_device,
    })
}

#[cfg(any(test, target_os = "windows"))]
fn bounded_dimensions(bounds: PhysicalRect) -> Result<(u32, u32), &'static str> {
    let width = i64::from(bounds.right) - i64::from(bounds.left);
    let height = i64::from(bounds.bottom) - i64::from(bounds.top);
    bounded_pixel_dimensions(width, height)
}

#[cfg(any(test, target_os = "windows"))]
fn bounded_pixel_dimensions(width: i64, height: i64) -> Result<(u32, u32), &'static str> {
    let width = u32::try_from(width).map_err(|_| "POLICY_DENIED")?;
    let height = u32::try_from(height).map_err(|_| "POLICY_DENIED")?;
    let pixels = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or("POLICY_DENIED")?;
    if width == 0
        || height == 0
        || width > MAX_NATIVE_CAPTURE_WIDTH
        || height > MAX_NATIVE_CAPTURE_HEIGHT
        || pixels > MAX_NATIVE_CAPTURE_PIXELS
    {
        return Err("POLICY_DENIED");
    }
    Ok((width, height))
}

#[cfg(target_os = "windows")]
fn validate_frame_size(size: SizeInt32, width: u32, height: u32) -> Result<(), &'static str> {
    if size.Width != i32::try_from(width).map_err(|_| "POLICY_DENIED")?
        || size.Height != i32::try_from(height).map_err(|_| "POLICY_DENIED")?
    {
        return Err("BINARY_MISMATCH");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn validate_exact_target(
    hwnd: HWND,
    expected_identity: WindowIdentity,
    expected_bounds: PhysicalRect,
) -> Result<(), &'static str> {
    if hwnd != expected_identity.hwnd()
        || !expected_identity.matches(query_window_identity(hwnd).map_err(|_| "STALE_REF")?)
    {
        return Err("STALE_REF");
    }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|_| "STALE_REF")?;
    let observed_bounds = PhysicalRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
    if observed_bounds != expected_bounds {
        return Err("STALE_REF");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn wait_for_frame_signal(
    receiver: &mpsc::Receiver<()>,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    loop {
        check_request(epoch, deadline_ms, cancel)?;
        let now_ms = u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        let wait_ms = deadline_ms.saturating_sub(now_ms).clamp(1, 10);
        match receiver.recv_timeout(Duration::from_millis(wait_ms)) {
            Ok(()) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("INTERNAL"),
        }
    }
}

#[cfg(target_os = "windows")]
fn check_request(
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    if cancel.is_cancelled() {
        return Err("CANCELLED");
    }
    if u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX) >= deadline_ms {
        return Err("TIMEOUT");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
struct CaptureResources {
    pool: Direct3D11CaptureFramePool,
    session: Option<GraphicsCaptureSession>,
    frame_token: Option<i64>,
}

#[cfg(target_os = "windows")]
impl Drop for CaptureResources {
    fn drop(&mut self) {
        if let Some(frame_token) = self.frame_token.take() {
            let _ = self.pool.RemoveFrameArrived(frame_token);
        }
        if let Some(session) = self.session.take() {
            let _ = session.Close();
        }
        let _ = self.pool.Close();
    }
}

#[cfg(target_os = "windows")]
struct CaptureDevice {
    native: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt: IDirect3DDevice,
}

#[cfg(target_os = "windows")]
impl Drop for CaptureDevice {
    fn drop(&mut self) {
        let _ = self.winrt.Close();
    }
}

#[cfg(target_os = "windows")]
struct CapturedWinRtFrame(Direct3D11CaptureFrame);

#[cfg(target_os = "windows")]
impl Drop for CapturedWinRtFrame {
    fn drop(&mut self) {
        let _ = self.0.Close();
    }
}

#[cfg(target_os = "windows")]
struct MappedTexture<'a> {
    context: &'a ID3D11DeviceContext,
    texture: &'a ID3D11Texture2D,
}

#[cfg(target_os = "windows")]
impl Drop for MappedTexture<'_> {
    fn drop(&mut self) {
        unsafe { self.context.Unmap(self.texture, 0) };
    }
}

pub(crate) fn encode_bounded_png(
    expected: WindowIdentity,
    expected_bounds: PhysicalRect,
    frame: CapturedFrame,
    limits: CaptureLimits,
) -> Result<Vec<u8>, &'static str> {
    if !expected.matches(frame.identity) || expected_bounds != frame.bounds {
        return Err("STALE_REF");
    }
    if frame.width == 0
        || frame.height == 0
        || frame.width > limits.max_width
        || frame.height > limits.max_height
    {
        return Err("POLICY_DENIED");
    }
    let row_bytes = usize::try_from(frame.width)
        .ok()
        .and_then(|width| width.checked_mul(4))
        .ok_or("POLICY_DENIED")?;
    let pixel_count = usize::try_from(frame.width)
        .ok()
        .and_then(|width| {
            usize::try_from(frame.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or("POLICY_DENIED")?;
    let source_bytes = frame
        .stride
        .checked_mul(usize::try_from(frame.height).map_err(|_| "POLICY_DENIED")?)
        .ok_or("POLICY_DENIED")?;
    if pixel_count > limits.max_pixels
        || frame.stride != row_bytes
        || frame.bgra.len() != source_bytes
    {
        return Err("POLICY_DENIED");
    }
    let scanline_bytes = row_bytes.checked_add(1).ok_or("POLICY_DENIED")?;
    let raw_capacity = scanline_bytes
        .checked_mul(usize::try_from(frame.height).map_err(|_| "POLICY_DENIED")?)
        .ok_or("POLICY_DENIED")?;
    let mut raw = Vec::with_capacity(raw_capacity);
    for row in frame.bgra.chunks_exact(frame.stride) {
        raw.push(0);
        for pixel in row[..row_bytes].chunks_exact(4) {
            raw.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
        }
    }
    let compressed = zlib_compress(&raw)?;
    let mut png = Vec::new();
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&frame.width.to_be_bytes());
    header.extend_from_slice(&frame.height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    append_chunk(&mut png, *b"IHDR", &header)?;
    append_chunk(&mut png, *b"IDAT", &compressed)?;
    append_chunk(&mut png, *b"IEND", &[])?;
    if png.len() > limits.max_png_bytes {
        return Err("POLICY_DENIED");
    }
    Ok(png)
}

fn zlib_compress(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).map_err(|_| "INTERNAL")?;
    encoder.finish().map_err(|_| "INTERNAL")
}

fn append_chunk(output: &mut Vec<u8>, kind: [u8; 4], data: &[u8]) -> Result<(), &'static str> {
    output.extend_from_slice(
        &u32::try_from(data.len())
            .map_err(|_| "POLICY_DENIED")?
            .to_be_bytes(),
    );
    output.extend_from_slice(&kind);
    output.extend_from_slice(data);
    let mut checksum_material = Vec::with_capacity(4 + data.len());
    checksum_material.extend_from_slice(&kind);
    checksum_material.extend_from_slice(data);
    output.extend_from_slice(&crc32(&checksum_material).to_be_bytes());
    Ok(())
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::{
        CaptureLimits, CaptureWorkerGate, CapturedFrame, bounded_dimensions,
        bounded_pixel_dimensions, copy_tight_bgra, encode_bounded_png,
    };
    use crate::platform::windows::identity::WindowIdentity;
    use crate::platform::windows::scale::PhysicalRect;

    #[test]
    fn bounds_native_capture_to_one_worker_until_cleanup_finishes() {
        let gate = CaptureWorkerGate::new();
        assert!(gate.try_acquire());
        assert!(!gate.try_acquire());
        gate.release();
        assert!(gate.try_acquire());
    }

    fn identity(created: u64) -> WindowIdentity {
        WindowIdentity::new(5, 7, created).expect("identity")
    }

    fn frame(created: u64) -> CapturedFrame {
        CapturedFrame {
            identity: identity(created),
            bounds: PhysicalRect {
                left: -4,
                top: -2,
                right: -2,
                bottom: -1,
            },
            width: 2,
            height: 1,
            stride: 8,
            bgra: vec![0, 0, 255, 255, 0, 255, 0, 255],
        }
    }

    fn limits() -> CaptureLimits {
        CaptureLimits {
            max_width: 8,
            max_height: 8,
            max_pixels: 64,
            max_png_bytes: 1024,
        }
    }

    #[test]
    fn encodes_an_exact_bounded_frame_as_an_immutable_png() {
        let expected_bounds = frame(11).bounds;
        let mut png = encode_bounded_png(identity(11), expected_bounds, frame(11), limits())
            .expect("bounded PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let original = png.clone();
        png[0] = 0;
        assert_eq!(&original[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn accepts_bounded_wgc_pixels_when_virtualized_window_bounds_differ() {
        let mut captured = frame(11);
        captured.width = 1;
        captured.height = 1;
        captured.stride = 4;
        captured.bgra = vec![0, 0, 255, 255];
        let png = encode_bounded_png(identity(11), captured.bounds, captured, limits())
            .expect("bounded WGC PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn rejects_reused_identity_changed_bounds_and_oversized_frames() {
        let expected_bounds = frame(11).bounds;
        assert_eq!(
            encode_bounded_png(identity(11), expected_bounds, frame(12), limits()),
            Err("STALE_REF"),
        );
        let mut changed = frame(11);
        changed.bounds.right = -1;
        assert_eq!(
            encode_bounded_png(identity(11), expected_bounds, changed, limits()),
            Err("STALE_REF"),
        );
        assert_eq!(
            encode_bounded_png(
                identity(11),
                expected_bounds,
                frame(11),
                CaptureLimits {
                    max_width: 1,
                    ..limits()
                },
            ),
            Err("POLICY_DENIED"),
        );
    }

    #[test]
    fn compresses_repetitive_window_pixels_before_enforcing_png_byte_limit() {
        let bounds = PhysicalRect {
            left: -256,
            top: -128,
            right: 0,
            bottom: 128,
        };
        let frame = CapturedFrame {
            identity: identity(11),
            bounds,
            width: 256,
            height: 256,
            stride: 256 * 4,
            bgra: vec![0; 256 * 256 * 4],
        };
        let png = encode_bounded_png(
            identity(11),
            bounds,
            frame,
            CaptureLimits {
                max_width: 256,
                max_height: 256,
                max_pixels: 256 * 256,
                max_png_bytes: 4_096,
            },
        )
        .expect("compressed PNG");
        assert!(png.len() < 4_096);
    }

    #[test]
    fn copies_mapped_rows_without_preserving_driver_padding() {
        let source = [
            1, 2, 3, 4, 5, 6, 7, 8, 99, 99, 99, 99, 9, 10, 11, 12, 13, 14, 15, 16, 88, 88, 88, 88,
        ];
        assert_eq!(
            copy_tight_bgra(&source, 12, 8, 2),
            Ok(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        );
        assert_eq!(
            copy_tight_bgra(&source[..19], 12, 8, 2),
            Err("BINARY_MISMATCH"),
        );
        assert_eq!(copy_tight_bgra(&source, 4, 8, 2), Err("BINARY_MISMATCH"),);
    }

    #[test]
    fn bounds_native_allocation_with_negative_desktop_coordinates() {
        assert_eq!(
            bounded_dimensions(PhysicalRect {
                left: -1_920,
                top: -1_080,
                right: 0,
                bottom: 0,
            }),
            Ok((1_920, 1_080)),
        );
        assert_eq!(
            bounded_dimensions(PhysicalRect {
                left: -1,
                top: 0,
                right: 2_048,
                bottom: 1,
            }),
            Err("POLICY_DENIED"),
        );
    }

    #[test]
    fn bounds_wgc_target_size_independently_from_virtualized_window_bounds() {
        assert_eq!(bounded_pixel_dimensions(584, 381), Ok((584, 381)));
        assert_eq!(bounded_pixel_dimensions(2_049, 381), Err("POLICY_DENIED"));
        assert_eq!(bounded_pixel_dimensions(584, 0), Err("POLICY_DENIED"));
    }
}
