//! ScreenCaptureKit-only exact-window enumeration and bounded still capture.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use block2::RcBlock;
use computer_use_core::{CancellationToken, ObservationBounds};
use objc2::msg_send;
use objc2::rc::{Allocated, Retained, autoreleasepool};
use objc2::runtime::{AnyClass, AnyObject, NSObject};
use objc2_foundation::{NSArray, NSRect, NSString};

use super::scale::attempt_dimensions;
use super::{WindowDescriptor, process_identity};

const MAX_PNG_BYTES: usize = 4_194_304;
const MAX_CAPTURE_EDGE: u32 = 2_048;
const MAX_CAPTURE_PIXELS: u64 = 4_194_304;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

#[link(name = "ScreenCaptureKit", kind = "framework")]
unsafe extern "C" {}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFRelease(value: *const c_void);
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        value: *const libc::c_char,
        encoding: u32,
    ) -> *const c_void;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGMainDisplayID() -> u32;
}

#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    fn CGImageDestinationCreateWithData(
        data: *mut c_void,
        image_type: *const c_void,
        count: usize,
        options: *const c_void,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(
        destination: *mut c_void,
        image: *const c_void,
        properties: *const c_void,
    );
    fn CGImageDestinationFinalize(destination: *mut c_void) -> bool;
}

/// Enumerate on-screen windows through SCK only.
pub fn query_windows(
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<Vec<WindowDescriptor>, &'static str> {
    check_request(epoch, deadline_ms, cancel)?;
    let class = AnyClass::get(c"SCShareableContent").ok_or("NOT_SUPPORTED")?;
    let (sender, receiver) = mpsc::channel();
    let accepted = Arc::new(AtomicBool::new(true));
    let callback_accepted = accepted.clone();
    let block: RcBlock<dyn Fn(*mut AnyObject, *mut AnyObject)> =
        RcBlock::new(move |content: *mut AnyObject, error: *mut AnyObject| {
            if !callback_accepted.swap(false, Ordering::SeqCst) {
                return;
            }
            let result = autoreleasepool(|_| {
                if !error.is_null() || content.is_null() {
                    return Err("PERMISSION_DENIED");
                }
                // SAFETY: SCK supplied a live SCShareableContent for this callback.
                unsafe { extract_windows(&*content) }
            });
            let _ = sender.send(result);
        });
    // SAFETY: Selector and block signature exactly match the macOS SCK declaration.
    unsafe {
        let _: () = msg_send![
            class,
            getShareableContentExcludingDesktopWindows: true,
            onScreenWindowsOnly: true,
            completionHandler: &*block
        ];
    }
    wait_for(receiver, accepted, epoch, deadline_ms, cancel)
}

/// Capture one freshly revalidated exact SCK window at one bounded scale attempt.
pub fn capture_exact_window(
    expected: &WindowDescriptor,
    attempt: usize,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, &'static str> {
    check_request(epoch, deadline_ms, cancel)?;
    // Public display identity initializes the process-wide CG connection required by SCK.
    // It neither captures content nor requests Screen Recording access.
    if unsafe { CGMainDisplayID() } == 0 {
        return Err("NOT_SUPPORTED");
    }
    let shareable_class = AnyClass::get(c"SCShareableContent").ok_or("NOT_SUPPORTED")?;
    let screenshot_class = AnyClass::get(c"SCScreenshotManager").ok_or("NOT_SUPPORTED")?;
    let filter_class = AnyClass::get(c"SCContentFilter").ok_or("NOT_SUPPORTED")?;
    let configuration_class = AnyClass::get(c"SCStreamConfiguration").ok_or("NOT_SUPPORTED")?;
    let (sender, receiver) = mpsc::channel();
    let accepted = Arc::new(AtomicBool::new(true));
    let callback_accepted = accepted.clone();
    let callback_expected = expected.clone();

    let block: RcBlock<dyn Fn(*mut AnyObject, *mut AnyObject)> =
        RcBlock::new(move |content: *mut AnyObject, error: *mut AnyObject| {
            if !callback_accepted.load(Ordering::SeqCst) {
                return;
            }
            if !error.is_null() || content.is_null() {
                finish(&callback_accepted, &sender, Err("TARGET_CLOSED"));
                return;
            }
            autoreleasepool(|_| {
                // SAFETY: All objects are callback-scoped SCK objects and selectors are fixed.
                unsafe {
                    let Some(window) = find_exact_window(&*content, &callback_expected) else {
                        finish(&callback_accepted, &sender, Err("TARGET_CLOSED"));
                        return;
                    };
                    if process_identity(
                        callback_expected.identity.pid,
                        &callback_expected.identity.bundle_id,
                    )
                    .as_ref()
                        != Some(&callback_expected.identity)
                    {
                        finish(&callback_accepted, &sender, Err("TARGET_CLOSED"));
                        return;
                    }

                    let allocated: Allocated<NSObject> = msg_send![filter_class, alloc];
                    let filter: Retained<NSObject> =
                        msg_send![allocated, initWithDesktopIndependentWindow: &*window];
                    let point_pixel_scale: f32 = msg_send![&filter, pointPixelScale];
                    let Some((width, height)) = attempt_dimensions(
                        callback_expected.bounds,
                        f64::from(point_pixel_scale),
                        attempt,
                    ) else {
                        finish(&callback_accepted, &sender, Err("INTERNAL"));
                        return;
                    };
                    let configuration: Retained<NSObject> = msg_send![configuration_class, new];
                    let _: () = msg_send![&configuration, setWidth: width as usize];
                    let _: () = msg_send![&configuration, setHeight: height as usize];
                    let _: () = msg_send![&configuration, setShowsCursor: false];
                    let _: () = msg_send![&configuration, setScalesToFit: true];
                    let _: () = msg_send![&configuration, setPreservesAspectRatio: true];

                    let image_accepted = callback_accepted.clone();
                    let image_sender = sender.clone();
                    let image_block: RcBlock<dyn Fn(*const c_void, *mut AnyObject)> =
                        RcBlock::new(move |image: *const c_void, capture_error: *mut AnyObject| {
                            if !image_accepted.swap(false, Ordering::SeqCst) {
                                return;
                            }
                            let result = if !capture_error.is_null() || image.is_null() {
                                Err("TARGET_CLOSED")
                            } else {
                                // SAFETY: SCK supplied a live CGImage for this callback.
                                encode_png(image)
                            };
                            let _ = image_sender.send(result);
                        });
                    let _: () = msg_send![
                        screenshot_class,
                        captureImageWithFilter: &*filter,
                        configuration: &*configuration,
                        completionHandler: &*image_block
                    ];
                }
            });
        });
    // SAFETY: Selector and block signature exactly match the macOS SCK declaration.
    unsafe {
        let _: () = msg_send![
            shareable_class,
            getShareableContentExcludingDesktopWindows: true,
            onScreenWindowsOnly: true,
            completionHandler: &*block
        ];
    }
    let png = wait_for(receiver, accepted, epoch, deadline_ms, cancel)?;
    let refreshed = query_windows(epoch, deadline_ms, cancel)?;
    if !unique_fresh_target(expected, &refreshed) {
        return Err("TARGET_CLOSED");
    }
    Ok(png)
}

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

fn wait_for<T>(
    receiver: mpsc::Receiver<Result<T, &'static str>>,
    accepted: Arc<AtomicBool>,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<T, &'static str> {
    loop {
        if cancel.is_cancelled() {
            accepted.store(false, Ordering::SeqCst);
            return Err("CANCELLED");
        }
        let now_ms = u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        if now_ms >= deadline_ms {
            accepted.store(false, Ordering::SeqCst);
            return Err("TIMEOUT");
        }
        let wait_ms = deadline_ms.saturating_sub(now_ms).min(10);
        match receiver.recv_timeout(Duration::from_millis(wait_ms)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("INTERNAL"),
        }
    }
}

fn finish<T>(
    accepted: &AtomicBool,
    sender: &mpsc::Sender<Result<T, &'static str>>,
    result: Result<T, &'static str>,
) {
    if accepted.swap(false, Ordering::SeqCst) {
        let _ = sender.send(result);
    }
}

unsafe fn extract_windows(content: &AnyObject) -> Result<Vec<WindowDescriptor>, &'static str> {
    // SAFETY: `windows` is a documented NSArray getter; objc2 retains it for iteration.
    let windows: Retained<NSArray<NSObject>> = unsafe { msg_send![content, windows] };
    Ok(windows
        .iter()
        .take(4_096)
        .filter_map(|window| unsafe { describe_window(&window) })
        .collect::<Vec<_>>())
}

unsafe fn find_exact_window(
    content: &AnyObject,
    expected: &WindowDescriptor,
) -> Option<Retained<NSObject>> {
    // SAFETY: `windows` is a documented NSArray getter; objc2 retains it for iteration.
    let windows: Retained<NSArray<NSObject>> = unsafe { msg_send![content, windows] };
    let mut matched = None;
    for window in windows.iter().take(4_096) {
        let Some(actual) = (unsafe { describe_window(&window) }) else {
            continue;
        };
        if actual.exactly_matches(expected) {
            if matched.is_some() {
                return None;
            }
            matched = Some(window);
        }
    }
    matched
}

fn unique_fresh_target(expected: &WindowDescriptor, windows: &[WindowDescriptor]) -> bool {
    windows
        .iter()
        .filter(|window| window.exactly_matches(expected))
        .count()
        == 1
}

unsafe fn describe_window(window: &NSObject) -> Option<WindowDescriptor> {
    // SAFETY: Fixed getters match SCWindow and SCRunningApplication declarations.
    let on_screen: bool = unsafe { msg_send![window, isOnScreen] };
    let layer: isize = unsafe { msg_send![window, windowLayer] };
    if !on_screen || layer < 0 {
        return None;
    }
    let frame: NSRect = unsafe { msg_send![window, frame] };
    let bounds = ObservationBounds {
        x: frame.origin.x,
        y: frame.origin.y,
        width: frame.size.width,
        height: frame.size.height,
    };
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
        || bounds.width <= 0.0
        || bounds.height <= 0.0
    {
        return None;
    }
    let owner: Option<Retained<NSObject>> = unsafe { msg_send![window, owningApplication] };
    let owner = owner?;
    let pid: i32 = unsafe { msg_send![&owner, processID] };
    let bundle: Retained<NSString> = unsafe { msg_send![&owner, bundleIdentifier] };
    if bundle.length() > 256 {
        return None;
    }
    let bundle_id = bundle.to_string();
    let identity = process_identity(pid, &bundle_id)?;
    let app_name: Retained<NSString> = unsafe { msg_send![&owner, applicationName] };
    let title: Option<Retained<NSString>> = unsafe { msg_send![window, title] };
    let window_id: u32 = unsafe { msg_send![window, windowID] };
    Some(WindowDescriptor {
        identity,
        app_name: bounded_nsstring(&app_name, 256),
        window_id,
        title: title.map_or_else(String::new, |value| bounded_nsstring(&value, 1_024)),
        bounds,
    })
}

unsafe fn encode_png(image: *const c_void) -> Result<Vec<u8>, &'static str> {
    const UTF8_ENCODING: u32 = 0x0800_0100;
    let data = unsafe { CFDataCreateMutable(std::ptr::null(), 0) };
    if data.is_null() {
        return Err("INTERNAL");
    }
    let image_type = unsafe {
        CFStringCreateWithCString(std::ptr::null(), c"public.png".as_ptr(), UTF8_ENCODING)
    };
    if image_type.is_null() {
        unsafe { CFRelease(data) };
        return Err("INTERNAL");
    }
    let destination =
        unsafe { CGImageDestinationCreateWithData(data, image_type, 1, std::ptr::null()) };
    unsafe { CFRelease(image_type) };
    if destination.is_null() {
        unsafe { CFRelease(data) };
        return Err("INTERNAL");
    }
    unsafe { CGImageDestinationAddImage(destination, image, std::ptr::null()) };
    let finalized = unsafe { CGImageDestinationFinalize(destination) };
    unsafe { CFRelease(destination) };
    if !finalized {
        unsafe { CFRelease(data) };
        return Err("INTERNAL");
    }
    let length = unsafe { CFDataGetLength(data) };
    if length <= 0
        || usize::try_from(length)
            .ok()
            .is_none_or(|length| length > MAX_PNG_BYTES)
    {
        unsafe { CFRelease(data) };
        return Err("BINARY_MISMATCH");
    }
    let bytes = unsafe { CFDataGetBytePtr(data) };
    if bytes.is_null() {
        unsafe { CFRelease(data) };
        return Err("INTERNAL");
    }
    // SAFETY: CFData owns this contiguous range until the copy completes.
    let result = unsafe { std::slice::from_raw_parts(bytes, length as usize) }.to_vec();
    unsafe { CFRelease(data) };
    if result.len() < 24 || result[..8] != PNG_SIGNATURE || &result[12..16] != b"IHDR" {
        return Err("BINARY_MISMATCH");
    }
    let width = u32::from_be_bytes(result[16..20].try_into().expect("PNG width"));
    let height = u32::from_be_bytes(result[20..24].try_into().expect("PNG height"));
    if width == 0
        || height == 0
        || width > MAX_CAPTURE_EDGE
        || height > MAX_CAPTURE_EDGE
        || u64::from(width) * u64::from(height) > MAX_CAPTURE_PIXELS
    {
        return Err("BINARY_MISMATCH");
    }
    Ok(result)
}

fn bounded_nsstring(value: &NSString, maximum_characters: usize) -> String {
    if value.length() <= maximum_characters {
        value.to_string()
    } else {
        value.substringToIndex(maximum_characters).to_string()
    }
}

#[cfg(test)]
mod tests {
    use computer_use_core::ObservationBounds;

    use super::unique_fresh_target;
    use crate::platform::macos::{MacProcessIdentity, WindowDescriptor};

    fn window(start_microseconds: u64) -> WindowDescriptor {
        WindowDescriptor {
            identity: MacProcessIdentity {
                pid: 123,
                start_seconds: 1_000,
                start_microseconds,
                bundle_id: "com.example.fixture".into(),
            },
            app_name: "Fixture".into(),
            window_id: 42,
            title: "Harmless".into(),
            bounds: ObservationBounds {
                x: 10.0,
                y: 20.0,
                width: 300.0,
                height: 200.0,
            },
        }
    }

    #[test]
    fn post_capture_revalidation_rejects_missing_duplicate_and_reused_targets() {
        let expected = window(55);
        assert!(unique_fresh_target(
            &expected,
            std::slice::from_ref(&expected)
        ));
        assert!(!unique_fresh_target(&expected, &[]));
        assert!(!unique_fresh_target(
            &expected,
            &[expected.clone(), expected.clone()]
        ));
        assert!(!unique_fresh_target(&expected, &[window(56)]));
    }
}
