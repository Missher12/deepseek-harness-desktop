//! Composition of the native Windows observation seams.

use std::collections::{BTreeMap, HashMap};

#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

use computer_use_core::{CancellationToken, NativeInputCost, ObservationPlatform, PlatformResult};
use computer_use_protocol::HelperRequest;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
use super::capture::capture_exact_window;
use super::capture::{CaptureLimits, CapturedFrame, encode_bounded_png};
use super::identity::WindowIdentity;
#[cfg(target_os = "windows")]
use super::input::{ClosedInputPlan, InputCommand, InputController, MouseButton, WinSendInputSink};
use super::permissions::PermissionSnapshot;
use super::scale::{Dpi, PhysicalRect};
#[cfg(target_os = "windows")]
use super::scale::{PhysicalPoint, virtual_desktop};
use super::uia::{ProjectionLimits, RawUiaNode, SemanticNode, project_semantics};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentProcessId;
#[cfg(target_os = "windows")]
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GA_ROOT, GW_OWNER, GetAncestor, GetWindow, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, IsIconic, IsWindowVisible,
};
#[cfg(target_os = "windows")]
use windows::core::BOOL;

#[cfg(target_os = "windows")]
use super::identity::{process_name, query_window_identity};
#[cfg(target_os = "windows")]
use super::permissions::{DesktopSecurity, native_permission_snapshot, platform_available};
#[cfg(target_os = "windows")]
use super::scale::{dpi_for_window, enable_per_monitor_v2};
#[cfg(target_os = "windows")]
use super::uia::{has_sensitive_surface, observe_exact_window};

type ApprovedTargets = HashMap<(String, String), WindowTarget>;
type ValidatedTargets = (ApprovedTargets, Vec<Value>);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PlatformStatus {
    pub(crate) viewing: &'static str,
    pub(crate) assistive: &'static str,
    pub(crate) supported: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WindowTarget {
    pub(crate) app_id: String,
    pub(crate) app_name: String,
    pub(crate) window_id: String,
    pub(crate) title: String,
    pub(crate) identity: WindowIdentity,
    pub(crate) bounds: PhysicalRect,
    pub(crate) dpi: Dpi,
    pub(crate) permissions: PermissionSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ObservedUia {
    pub(crate) identity: WindowIdentity,
    pub(crate) bounds: PhysicalRect,
    pub(crate) dpi: Dpi,
    pub(crate) permissions: PermissionSnapshot,
    pub(crate) roots: Vec<RawUiaNode>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedSnapshot {
    pub(crate) result: Value,
    pub(crate) png: Option<Vec<u8>>,
    target: WindowTarget,
    included_image: bool,
    semantics: Vec<SemanticNode>,
}

pub(crate) trait WindowsApi {
    fn status(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<PlatformStatus, &'static str>;
    fn list_windows(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<Vec<WindowTarget>, &'static str>;
    fn observe_uia(
        &mut self,
        target: &WindowTarget,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<ObservedUia, &'static str>;
    fn capture_window(
        &mut self,
        target: &WindowTarget,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<CapturedFrame, &'static str>;
}

#[cfg(not(target_os = "windows"))]
#[derive(Default)]
pub(crate) struct NativeWindowsApi;

#[cfg(target_os = "windows")]
pub(crate) struct NativeWindowsApi {
    epoch: Instant,
    runtime_initialized: bool,
    dpi_ready: bool,
}

#[cfg(target_os = "windows")]
impl NativeWindowsApi {
    fn new(epoch: Instant) -> Self {
        Self {
            epoch,
            runtime_initialized: unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok(),
            dpi_ready: enable_per_monitor_v2(),
        }
    }

    fn precheck(&self, deadline_ms: u64, cancel: &CancellationToken) -> Result<(), &'static str> {
        if cancel.is_cancelled() {
            return Err("CANCELLED");
        }
        if u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX) >= deadline_ms {
            return Err("TIMEOUT");
        }
        if !self.runtime_initialized || !self.dpi_ready {
            return Err("NOT_SUPPORTED");
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
impl Drop for NativeWindowsApi {
    fn drop(&mut self) {
        if self.runtime_initialized {
            unsafe { RoUninitialize() };
        }
    }
}

impl WindowsApi for NativeWindowsApi {
    fn status(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<PlatformStatus, &'static str> {
        #[cfg(target_os = "windows")]
        {
            self.precheck(deadline_ms, cancel)?;
            let (capture, uia, desktop) = platform_available();
            let interactive = desktop == DesktopSecurity::Interactive;
            Ok(PlatformStatus {
                viewing: if capture && interactive {
                    "granted"
                } else {
                    "denied"
                },
                assistive: if uia && interactive {
                    "granted"
                } else {
                    "denied"
                },
                supported: capture && uia && interactive,
            })
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (deadline_ms, cancel);
        #[cfg(not(target_os = "windows"))]
        Ok(PlatformStatus {
            viewing: "unknown",
            assistive: "unknown",
            supported: false,
        })
    }

    fn list_windows(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<Vec<WindowTarget>, &'static str> {
        #[cfg(target_os = "windows")]
        {
            self.precheck(deadline_ms, cancel)?;
            enumerate_windows(cancel)
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (deadline_ms, cancel);
        #[cfg(not(target_os = "windows"))]
        Ok(Vec::new())
    }

    fn observe_uia(
        &mut self,
        target: &WindowTarget,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<ObservedUia, &'static str> {
        #[cfg(target_os = "windows")]
        {
            self.precheck(deadline_ms, cancel)?;
            let identity = query_window_identity(target.identity.hwnd())?;
            let bounds = window_bounds(target.identity.hwnd())?;
            let dpi = dpi_for_window(target.identity.hwnd())?;
            if !target.identity.matches(identity) || target.bounds != bounds || target.dpi != dpi {
                return Err("STALE_REF");
            }
            native_permission_snapshot(identity.pid, false).authorize_observation()?;
            let roots = observe_exact_window(identity.hwnd(), identity.pid, cancel)?;
            let permissions =
                native_permission_snapshot(identity.pid, has_sensitive_surface(&roots));
            permissions.authorize_observation()?;
            self.precheck(deadline_ms, cancel)?;
            Ok(ObservedUia {
                identity,
                bounds,
                dpi,
                permissions,
                roots,
            })
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (target, deadline_ms, cancel);
        #[cfg(not(target_os = "windows"))]
        Err("NOT_SUPPORTED")
    }

    fn capture_window(
        &mut self,
        target: &WindowTarget,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<CapturedFrame, &'static str> {
        #[cfg(target_os = "windows")]
        {
            self.precheck(deadline_ms, cancel)?;
            target.permissions.authorize_capture()?;
            capture_exact_window(
                target.identity.hwnd(),
                target.identity,
                target.bounds,
                &self.epoch,
                deadline_ms,
                cancel,
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (target, deadline_ms, cancel);
            Err("NOT_SUPPORTED")
        }
    }
}

#[cfg(target_os = "windows")]
fn enumerate_windows(cancel: &CancellationToken) -> Result<Vec<WindowTarget>, &'static str> {
    let mut handles = Vec::with_capacity(4_096);
    unsafe extern "system" fn collect(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let handles = unsafe { &mut *(parameter.0 as *mut Vec<HWND>) };
        if handles.len() >= handles.capacity() {
            return BOOL(0);
        }
        handles.push(hwnd);
        BOOL(1)
    }
    unsafe {
        EnumWindows(
            Some(collect),
            LPARAM((&mut handles as *mut Vec<HWND>) as isize),
        )
        .map_err(|_| "PERMISSION_DENIED")?;
    }
    let own_pid = unsafe { GetCurrentProcessId() };
    let mut targets = Vec::new();
    for hwnd in handles {
        if cancel.is_cancelled() {
            return Err("CANCELLED");
        }
        if !candidate_window(hwnd) {
            continue;
        }
        let Ok(identity) = query_window_identity(hwnd) else {
            continue;
        };
        if identity.pid == own_pid {
            continue;
        }
        let Ok(bounds) = window_bounds(hwnd) else {
            continue;
        };
        let Ok(dpi) = dpi_for_window(hwnd) else {
            continue;
        };
        let permissions = native_permission_snapshot(identity.pid, false);
        if permissions.authorize_observation().is_err() {
            continue;
        }
        let Ok(title) = window_title(hwnd) else {
            continue;
        };
        let Ok(app_name) = process_name(identity.pid) else {
            continue;
        };
        let app_id = format!(
            "win-app:{}:{}",
            identity.pid, identity.process_created_at_100ns
        );
        let window_id = format!(
            "win-window:{:x}:{}:{}:{}",
            identity.hwnd as u64, identity.pid, identity.process_created_at_100ns, dpi.x,
        );
        targets.push(WindowTarget {
            app_id,
            app_name,
            window_id,
            title,
            identity,
            bounds,
            dpi,
            permissions,
        });
    }
    Ok(targets)
}

#[cfg(target_os = "windows")]
fn candidate_window(hwnd: HWND) -> bool {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool()
        || unsafe { IsIconic(hwnd) }.as_bool()
        || unsafe { GetAncestor(hwnd, GA_ROOT) } != hwnd
        || unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok()
    {
        return false;
    }
    let mut cloaked = 0_u32;
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            u32::try_from(core::mem::size_of::<u32>()).unwrap_or(u32::MAX),
        )
    }
    .is_ok_and(|()| cloaked == 0)
}

#[cfg(target_os = "windows")]
fn window_bounds(hwnd: HWND) -> Result<PhysicalRect, &'static str> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|_| "TARGET_CLOSED")?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return Err("TARGET_CLOSED");
    }
    Ok(PhysicalRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

#[cfg(target_os = "windows")]
fn window_title(hwnd: HWND) -> Result<String, &'static str> {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 || length > 32_768 {
        return Err("TARGET_CLOSED");
    }
    let mut buffer = vec![0_u16; usize::try_from(length).map_err(|_| "INTERNAL")? + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied <= 0 {
        return Err("TARGET_CLOSED");
    }
    Ok(String::from_utf16_lossy(
        &buffer[..usize::try_from(copied).map_err(|_| "INTERNAL")?],
    ))
}

pub(crate) struct WindowsObservationPlatform<A = NativeWindowsApi> {
    api: A,
    approved: ApprovedTargets,
    projection_limits: ProjectionLimits,
    capture_limits: CaptureLimits,
    pending_png: Option<Vec<u8>>,
    #[cfg(target_os = "windows")]
    latest_snapshot: Option<LiveSnapshot>,
    #[cfg(target_os = "windows")]
    input: InputController<WinSendInputSink>,
    #[cfg(target_os = "windows")]
    epoch: Instant,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct LiveSnapshot {
    target: WindowTarget,
    revision: u64,
    included_image: bool,
    semantics: Vec<SemanticNode>,
}

#[cfg(target_os = "windows")]
impl WindowsObservationPlatform<NativeWindowsApi> {
    pub(crate) fn new(epoch: Instant) -> Self {
        let mut platform = Self::with_api(NativeWindowsApi::new(epoch));
        platform.epoch = epoch;
        platform
    }
}

impl<A> WindowsObservationPlatform<A> {
    pub(crate) fn with_api(api: A) -> Self {
        Self {
            api,
            approved: HashMap::new(),
            projection_limits: ProjectionLimits {
                max_nodes: 300,
                max_depth: 64,
                max_text_bytes: 49_152,
            },
            capture_limits: CaptureLimits {
                max_width: 2_048,
                max_height: 2_048,
                max_pixels: 4_194_304,
                max_png_bytes: 4_194_304,
            },
            pending_png: None,
            #[cfg(target_os = "windows")]
            latest_snapshot: None,
            #[cfg(target_os = "windows")]
            input: InputController::new(WinSendInputSink),
            #[cfg(target_os = "windows")]
            epoch: Instant::now(),
        }
    }
}

impl<A: WindowsApi> WindowsObservationPlatform<A> {
    pub(crate) fn prepare_snapshot(
        &mut self,
        request: &HelperRequest,
        snapshot_revision: u64,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<PreparedSnapshot, &'static str> {
        check_cancel(cancel)?;
        let app_id = request.string("appId").ok_or("INTERNAL")?;
        let window_id = request.string("windowId").ok_or("INTERNAL")?;
        let include_image = request.boolean("includeImage").ok_or("INTERNAL")?;
        let target = self
            .approved
            .get(&(app_id.to_owned(), window_id.to_owned()))
            .cloned()
            .ok_or("STALE_REF")?;
        target.permissions.authorize_observation()?;
        check_cancel(cancel)?;
        let observed = self.api.observe_uia(&target, deadline_ms, cancel)?;
        check_cancel(cancel)?;
        if !target.identity.matches(observed.identity)
            || target.bounds != observed.bounds
            || target.dpi != observed.dpi
        {
            return Err("STALE_REF");
        }
        observed.permissions.authorize_observation()?;
        let identity_material = format!(
            "{}:{}:{}:{}:{}",
            target.identity.hwnd,
            target.identity.pid,
            target.identity.process_created_at_100ns,
            observed.dpi.x,
            observed.dpi.y,
        );
        let semantic_nodes = project_semantics(
            identity_material.as_bytes(),
            snapshot_revision,
            &observed.roots,
            self.projection_limits,
        )?;
        let semantic_text = semantic_text(&semantic_nodes)?;
        let refs = semantic_nodes
            .iter()
            .map(|node| {
                json!({
                    "ref": node.reference,
                    "role": node.role,
                    "name": node.name.as_deref().unwrap_or(""),
                })
            })
            .collect::<Vec<_>>();
        let captured = if include_image {
            observed.permissions.authorize_capture()?;
            check_cancel(cancel)?;
            let frame = self.api.capture_window(&target, deadline_ms, cancel)?;
            check_cancel(cancel)?;
            let width = frame.width;
            let height = frame.height;
            let png = encode_bounded_png(
                observed.identity,
                observed.bounds,
                frame,
                self.capture_limits,
            )?;
            Some((png, width, height))
        } else {
            None
        };
        let mut result = json!({
            "appId": app_id,
            "windowId": window_id,
            "snapshotRevision": snapshot_revision,
            "semanticText": semantic_text,
            "refs": refs,
        });
        let png = captured.map(|(png, width, height)| {
            result["image"] = json!({
                "transferId": request.request_id(),
                "byteLength": png.len(),
                "sha256": format!("{:x}", Sha256::digest(&png)),
                "width": width,
                "height": height,
            });
            png
        });
        Ok(PreparedSnapshot {
            result,
            png,
            target,
            included_image: include_image,
            semantics: semantic_nodes,
        })
    }
}

#[cfg(target_os = "windows")]
impl<A: WindowsApi> WindowsObservationPlatform<A> {
    fn check_deadline(
        &self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<(), &'static str> {
        check_deadline(self.epoch, deadline_ms, cancel)
    }

    fn input_request(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
        permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> PlatformResult {
        self.check_deadline(deadline_ms, cancel)?;
        let snapshot = self.latest_snapshot.clone().ok_or("STALE_REF")?;
        if snapshot.revision != request.integer("snapshotRevision").ok_or("INTERNAL")?
            || snapshot.target.app_id != request.string("appId").ok_or("INTERNAL")?
            || snapshot.target.window_id != request.string("windowId").ok_or("INTERNAL")?
        {
            return Err("STALE_REF");
        }
        ensure_safe_target(&snapshot.target.app_name, &snapshot.target.title)?;
        if request.request_kind() == "wait" {
            permit(NativeInputCost::operation())?;
            wait_exact(
                &mut self.api,
                &snapshot,
                self.projection_limits,
                self.epoch,
                request.integer("durationMs").ok_or("INTERNAL")?,
                deadline_ms,
                cancel,
            )?;
            return Ok(json!({"waited":true,"snapshotRevision":snapshot.revision}));
        }

        let (command, expected_ref, require_focused, inspect_focused) =
            input_command(request, &snapshot)?;
        let plan = ClosedInputPlan::command(command, virtual_desktop()?)?;
        let projection_limits = self.projection_limits;
        let epoch = self.epoch;
        let validation_snapshot = snapshot.clone();
        let (api, input) = (&mut self.api, &mut self.input);
        let mut validate = || {
            validate_live(
                api,
                &validation_snapshot,
                expected_ref.as_ref(),
                require_focused,
                inspect_focused,
                projection_limits,
                epoch,
                deadline_ms,
                cancel,
            )
        };
        input.execute(&plan, &mut validate, permit)?;
        Ok(json!({"acted":true,"snapshotRevision":snapshot.revision}))
    }
}

#[cfg(target_os = "windows")]
fn input_command(
    request: &HelperRequest,
    snapshot: &LiveSnapshot,
) -> Result<(InputCommand, Option<SemanticNode>, bool, bool), &'static str> {
    let semantic_ref = || -> Result<SemanticNode, &'static str> {
        let ref_id = request.string("ref").ok_or("INTERNAL")?;
        let reference = snapshot
            .semantics
            .iter()
            .find(|node| node.reference == ref_id)
            .cloned()
            .ok_or("STALE_REF")?;
        ensure_safe_semantic(&snapshot.target, &reference)?;
        if !reference.enabled || reference.sensitive {
            return Err("POLICY_DENIED");
        }
        Ok(reference)
    };
    match request.request_kind() {
        "focus" => Ok((
            InputCommand::Focus(title_bar_point(snapshot.target.bounds)?),
            None,
            false,
            false,
        )),
        "click" | "double-click" => {
            let button = MouseButton::parse(request.string("button").ok_or("INTERNAL")?)?;
            let (point, reference) = if request.string("ref").is_some() {
                let reference = semantic_ref()?;
                if !pointer_role(&reference.role) {
                    return Err("POLICY_DENIED");
                }
                (
                    semantic_center(&reference, snapshot.target.bounds)?,
                    Some(reference),
                )
            } else {
                require_visual(snapshot)?;
                (
                    request_point(request, "x", "y", snapshot.target.bounds)?,
                    None,
                )
            };
            Ok((
                InputCommand::Click {
                    point,
                    button,
                    count: if request.request_kind() == "double-click" {
                        2
                    } else {
                        1
                    },
                },
                reference,
                false,
                false,
            ))
        }
        "drag" => {
            require_visual(snapshot)?;
            Ok((
                InputCommand::Drag {
                    from: request_point(request, "fromX", "fromY", snapshot.target.bounds)?,
                    to: request_point(request, "toX", "toY", snapshot.target.bounds)?,
                    button: MouseButton::parse(request.string("button").ok_or("INTERNAL")?)?,
                },
                None,
                false,
                false,
            ))
        }
        "type" => {
            let reference = semantic_ref()?;
            if !reference.editable || !reference.focused {
                return Err("POLICY_DENIED");
            }
            Ok((
                InputCommand::Unicode(request.string("text").ok_or("INTERNAL")?.to_owned()),
                Some(reference),
                true,
                false,
            ))
        }
        "key" => {
            let modifiers = request
                .field("modifiers")
                .and_then(Value::as_array)
                .ok_or("INTERNAL")?
                .iter()
                .map(|value| value.as_str().map(ToOwned::to_owned).ok_or("INTERNAL"))
                .collect::<Result<Vec<_>, _>>()?;
            Ok((
                InputCommand::Key {
                    key: request.string("key").ok_or("INTERNAL")?.to_owned(),
                    modifiers,
                },
                None,
                false,
                true,
            ))
        }
        "scroll" => {
            let (point, reference) = if request.string("ref").is_some() {
                let reference = semantic_ref()?;
                if !scroll_role(&reference.role) {
                    return Err("POLICY_DENIED");
                }
                (
                    semantic_center(&reference, snapshot.target.bounds)?,
                    Some(reference),
                )
            } else {
                require_visual(snapshot)?;
                (
                    request_point(request, "x", "y", snapshot.target.bounds)?,
                    None,
                )
            };
            Ok((
                InputCommand::Scroll {
                    point,
                    delta_x: request_delta(request, "deltaX")?,
                    delta_y: request_delta(request, "deltaY")?,
                },
                reference,
                false,
                false,
            ))
        }
        _ => Err("NOT_SUPPORTED"),
    }
}

#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn validate_live<A: WindowsApi>(
    api: &mut A,
    snapshot: &LiveSnapshot,
    expected_ref: Option<&SemanticNode>,
    require_focused: bool,
    inspect_focused: bool,
    projection_limits: ProjectionLimits,
    epoch: Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    check_deadline(epoch, deadline_ms, cancel)?;
    let observed = api.observe_uia(&snapshot.target, deadline_ms, cancel)?;
    if !snapshot.target.identity.matches(observed.identity)
        || snapshot.target.bounds != observed.bounds
        || snapshot.target.dpi != observed.dpi
    {
        return Err("STALE_REF");
    }
    observed.permissions.authorize_input()?;
    ensure_safe_target(&snapshot.target.app_name, &snapshot.target.title)?;
    let current = project_observed(
        &snapshot.target,
        snapshot.revision,
        &observed,
        projection_limits,
    )?;
    if inspect_focused && current.iter().any(|node| node.focused && node.sensitive) {
        return Err("POLICY_DENIED");
    }
    if let Some(expected) = expected_ref {
        let current = current
            .iter()
            .find(|node| node.reference == expected.reference)
            .ok_or("STALE_REF")?;
        if current.role != expected.role
            || current.name != expected.name
            || current.bounds != expected.bounds
            || current.enabled != expected.enabled
            || current.sensitive != expected.sensitive
            || current.editable != expected.editable
        {
            return Err("STALE_REF");
        }
        ensure_safe_semantic(&snapshot.target, current)?;
        if current.sensitive
            || !current.enabled
            || require_focused && (!current.editable || !current.focused)
        {
            return Err("POLICY_DENIED");
        }
    }
    check_deadline(epoch, deadline_ms, cancel)
}

#[cfg(target_os = "windows")]
fn project_observed(
    target: &WindowTarget,
    revision: u64,
    observed: &ObservedUia,
    limits: ProjectionLimits,
) -> Result<Vec<SemanticNode>, &'static str> {
    let material = identity_material(target.identity, observed.dpi);
    project_semantics(material.as_bytes(), revision, &observed.roots, limits)
}

#[cfg(target_os = "windows")]
fn wait_exact<A: WindowsApi>(
    api: &mut A,
    snapshot: &LiveSnapshot,
    projection_limits: ProjectionLimits,
    epoch: Instant,
    duration_ms: u64,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    let end = u64::try_from(epoch.elapsed().as_millis())
        .unwrap_or(u64::MAX)
        .saturating_add(duration_ms);
    loop {
        validate_live(
            api,
            snapshot,
            None,
            false,
            false,
            projection_limits,
            epoch,
            deadline_ms,
            cancel,
        )?;
        let now = u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        if now >= end {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(end.saturating_sub(now).min(5)));
    }
}

#[cfg(target_os = "windows")]
fn check_deadline(
    epoch: Instant,
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
fn identity_material(identity: WindowIdentity, dpi: Dpi) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        identity.hwnd, identity.pid, identity.process_created_at_100ns, dpi.x, dpi.y,
    )
}

#[cfg(target_os = "windows")]
fn title_bar_point(bounds: PhysicalRect) -> Result<PhysicalPoint, &'static str> {
    let width = bounds.right.checked_sub(bounds.left).ok_or("STALE_REF")?;
    let height = bounds.bottom.checked_sub(bounds.top).ok_or("STALE_REF")?;
    if width <= 0 || height <= 0 {
        return Err("STALE_REF");
    }
    Ok(PhysicalPoint {
        x: bounds.left.checked_add(width / 2).ok_or("POLICY_DENIED")?,
        y: bounds
            .top
            .checked_add(height.min(24) / 2)
            .ok_or("POLICY_DENIED")?,
    })
}

#[cfg(target_os = "windows")]
fn semantic_center(
    node: &SemanticNode,
    window: PhysicalRect,
) -> Result<PhysicalPoint, &'static str> {
    let bounds = node.bounds.ok_or("STALE_REF")?;
    let left = bounds.left.max(window.left);
    let top = bounds.top.max(window.top);
    let right = bounds.right.min(window.right);
    let bottom = bounds.bottom.min(window.bottom);
    if left >= right || top >= bottom {
        return Err("STALE_REF");
    }
    Ok(PhysicalPoint {
        x: i32::try_from((i64::from(left) + i64::from(right)) / 2).map_err(|_| "POLICY_DENIED")?,
        y: i32::try_from((i64::from(top) + i64::from(bottom)) / 2).map_err(|_| "POLICY_DENIED")?,
    })
}

#[cfg(target_os = "windows")]
fn request_point(
    request: &HelperRequest,
    x_field: &str,
    y_field: &str,
    bounds: PhysicalRect,
) -> Result<PhysicalPoint, &'static str> {
    let coordinate = |field: &str| -> Result<i32, &'static str> {
        let value = request
            .field(field)
            .and_then(Value::as_f64)
            .ok_or("INTERNAL")?;
        if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
            return Err("POLICY_DENIED");
        }
        Ok(value.round() as i32)
    };
    let point = PhysicalPoint {
        x: coordinate(x_field)?,
        y: coordinate(y_field)?,
    };
    if point.x < bounds.left
        || point.x >= bounds.right
        || point.y < bounds.top
        || point.y >= bounds.bottom
    {
        return Err("POLICY_DENIED");
    }
    Ok(point)
}

#[cfg(target_os = "windows")]
fn request_delta(request: &HelperRequest, field: &str) -> Result<i32, &'static str> {
    let value = request
        .field(field)
        .and_then(Value::as_f64)
        .ok_or("INTERNAL")?;
    if !value.is_finite() || value.abs() > 1_000_000.0 {
        return Err("POLICY_DENIED");
    }
    Ok(value.round() as i32)
}

#[cfg(target_os = "windows")]
fn require_visual(snapshot: &LiveSnapshot) -> Result<(), &'static str> {
    snapshot.included_image.then_some(()).ok_or("POLICY_DENIED")
}

#[cfg(target_os = "windows")]
fn pointer_role(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "checkbox"
            | "radiobutton"
            | "menuitem"
            | "combobox"
            | "link"
            | "tab"
            | "tabitem"
            | "edit"
    )
}

#[cfg(target_os = "windows")]
fn scroll_role(role: &str) -> bool {
    matches!(
        role,
        "scrollbar" | "list" | "table" | "datagrid" | "tree" | "document" | "edit" | "pane"
    )
}

#[cfg(target_os = "windows")]
fn ensure_safe_target(app_name: &str, title: &str) -> Result<(), &'static str> {
    let text = format!("{app_name} {title}").to_ascii_lowercase();
    if [
        "password",
        "passcode",
        "1password",
        "bitwarden",
        "lastpass",
        "dashlane",
        "credential",
        "security",
        "privacy",
        "payment",
        "credit card",
        "bank",
        "密码",
        "口令",
        "隐私",
        "安全",
        "支付",
        "银行卡",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        Err("POLICY_DENIED")
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn ensure_safe_semantic(target: &WindowTarget, node: &SemanticNode) -> Result<(), &'static str> {
    ensure_safe_target(&target.app_name, &target.title)?;
    let text = format!("{} {}", node.role, node.name.as_deref().unwrap_or("")).to_ascii_lowercase();
    if text.trim().is_empty()
        || [
            "password",
            "passcode",
            "one-time",
            "otp",
            "payment",
            "credit card",
            "security code",
            "credential",
            "biometric",
            "privacy",
            "send",
            "submit",
            "delete",
            "uninstall",
            "install update",
            "密码",
            "口令",
            "验证码",
            "支付",
            "隐私",
            "发送",
            "提交",
            "删除",
            "卸载",
        ]
        .iter()
        .any(|needle| text.contains(needle))
    {
        Err("POLICY_DENIED")
    } else {
        Ok(())
    }
}

impl<A: WindowsApi> ObservationPlatform for WindowsObservationPlatform<A> {
    fn status(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult {
        check_cancel(cancel)?;
        let status = self.api.status(deadline_ms, cancel)?;
        check_cancel(cancel)?;
        if !matches!(status.viewing, "granted" | "denied" | "unknown")
            || !matches!(status.assistive, "granted" | "denied" | "unknown")
        {
            return Err("INTERNAL");
        }
        Ok(json!({
            "viewing": status.viewing,
            "assistive": status.assistive,
            "supported": status.supported,
        }))
    }

    fn list(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult {
        check_cancel(cancel)?;
        let targets = self.api.list_windows(deadline_ms, cancel)?;
        check_cancel(cancel)?;
        let (approved, apps) = validate_targets(targets)?;
        self.approved = approved;
        Ok(json!({"apps": apps}))
    }

    fn snapshot(
        &mut self,
        request: &HelperRequest,
        snapshot_revision: u64,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        self.pending_png = None;
        #[cfg(target_os = "windows")]
        {
            self.latest_snapshot = None;
        }
        let prepared = self.prepare_snapshot(request, snapshot_revision, deadline_ms, cancel)?;
        #[cfg(target_os = "windows")]
        {
            self.latest_snapshot = Some(LiveSnapshot {
                target: prepared.target.clone(),
                revision: snapshot_revision,
                included_image: prepared.included_image,
                semantics: prepared.semantics.clone(),
            });
        }
        self.pending_png = prepared.png;
        Ok(prepared.result)
    }

    fn input(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
        permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> PlatformResult {
        #[cfg(target_os = "windows")]
        {
            self.input_request(request, deadline_ms, cancel, permit)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (request, deadline_ms, cancel, permit);
            Err("NOT_SUPPORTED")
        }
    }

    fn release_input(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        #[cfg(target_os = "windows")]
        {
            self.check_deadline(deadline_ms, cancel)?;
            let keys = request
                .field("keys")
                .and_then(Value::as_array)
                .ok_or("INTERNAL")?
                .iter()
                .map(|value| value.as_str().map(ToOwned::to_owned).ok_or("INTERNAL"))
                .collect::<Result<Vec<_>, _>>()?;
            let buttons = request
                .field("buttons")
                .and_then(Value::as_array)
                .ok_or("INTERNAL")?
                .iter()
                .map(|value| MouseButton::parse(value.as_str().ok_or("INTERNAL")?))
                .collect::<Result<Vec<_>, _>>()?;
            self.input.release_requested(&keys, &buttons)?;
            self.check_deadline(deadline_ms, cancel)?;
            Ok(json!({"released":true}))
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (request, deadline_ms, cancel);
            Err("NOT_SUPPORTED")
        }
    }

    fn release_all_input(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<(), &'static str> {
        #[cfg(target_os = "windows")]
        {
            self.check_deadline(deadline_ms, cancel)?;
            self.input.release_all()
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (deadline_ms, cancel);
            Ok(())
        }
    }

    fn take_png(&mut self) -> Option<Vec<u8>> {
        self.pending_png.take()
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), &'static str> {
    if cancel.is_cancelled() {
        return Err("CANCELLED");
    }
    Ok(())
}

fn validate_targets(targets: Vec<WindowTarget>) -> Result<ValidatedTargets, &'static str> {
    let mut approved = HashMap::new();
    let mut grouped: BTreeMap<String, (String, Vec<Value>)> = BTreeMap::new();
    for target in targets {
        if target.app_id.is_empty()
            || target.app_id.len() > 256
            || target.app_name.is_empty()
            || target.app_name.len() > 256
            || target.window_id.is_empty()
            || target.window_id.len() > 256
            || target.title.len() > 1_024
            || target.bounds.right <= target.bounds.left
            || target.bounds.bottom <= target.bounds.top
            || target.dpi.x == 0
            || target.dpi.y == 0
        {
            return Err("POLICY_DENIED");
        }
        let key = (target.app_id.clone(), target.window_id.clone());
        if approved.insert(key, target.clone()).is_some() {
            return Err("POLICY_DENIED");
        }
        let group = grouped
            .entry(target.app_id.clone())
            .or_insert_with(|| (target.app_name.clone(), Vec::new()));
        if group.0 != target.app_name || group.1.len() >= 256 {
            return Err("POLICY_DENIED");
        }
        group
            .1
            .push(json!({"windowId": target.window_id, "title": target.title}));
    }
    if grouped.len() > 128 {
        return Err("POLICY_DENIED");
    }
    let apps = grouped
        .into_iter()
        .map(|(app_id, (name, windows))| json!({"appId": app_id, "name": name, "windows": windows}))
        .collect();
    Ok((approved, apps))
}

fn semantic_text(nodes: &[SemanticNode]) -> Result<String, &'static str> {
    let mut text = String::new();
    for node in nodes {
        if node.role.is_empty() || node.role.len() > 128 {
            return Err("POLICY_DENIED");
        }
        let name = node.name.as_deref().unwrap_or("");
        if name.len() > 1_024 {
            return Err("POLICY_DENIED");
        }
        let bounds = node.bounds.map_or_else(
            || "none".to_owned(),
            |bounds| {
                format!(
                    "{},{},{},{}",
                    bounds.left, bounds.top, bounds.right, bounds.bottom
                )
            },
        );
        let value = node.value.as_deref().unwrap_or("");
        let line = format!(
            "[{}] role={} name={} value={} bounds={} enabled={}\n",
            node.reference,
            clean_text(&node.role),
            clean_text(name),
            clean_text(value),
            bounds,
            node.enabled,
        );
        if text
            .len()
            .checked_add(line.len())
            .is_none_or(|length| length > 49_152)
        {
            return Err("POLICY_DENIED");
        }
        text.push_str(&line);
    }
    Ok(text)
}

fn clean_text(text: &str) -> String {
    text.chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;

    use computer_use_core::{CancellationToken, ObservationPlatform};
    use computer_use_protocol::{HelperInput, decode_helper_input};
    use serde_json::{Value, json};

    use super::{
        NativeWindowsApi, ObservedUia, PlatformStatus, WindowTarget, WindowsApi,
        WindowsObservationPlatform,
    };
    use crate::platform::windows::capture::CapturedFrame;
    use crate::platform::windows::identity::WindowIdentity;
    use crate::platform::windows::permissions::{
        DesktopSecurity, IntegrityLevel, PermissionSnapshot,
    };
    use crate::platform::windows::scale::{Dpi, PhysicalRect};
    use crate::platform::windows::uia::RawUiaNode;

    #[derive(Clone)]
    struct FakeWindowsApi {
        target: WindowTarget,
        observed_identity: WindowIdentity,
        capture_calls: Rc<Cell<usize>>,
    }

    impl WindowsApi for FakeWindowsApi {
        fn status(
            &mut self,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> Result<PlatformStatus, &'static str> {
            Ok(PlatformStatus {
                viewing: "granted",
                assistive: "granted",
                supported: true,
            })
        }

        fn list_windows(
            &mut self,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> Result<Vec<WindowTarget>, &'static str> {
            Ok(vec![self.target.clone()])
        }

        fn observe_uia(
            &mut self,
            _target: &WindowTarget,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> Result<ObservedUia, &'static str> {
            Ok(ObservedUia {
                identity: self.observed_identity,
                bounds: self.target.bounds,
                dpi: self.target.dpi,
                permissions: self.target.permissions,
                roots: vec![RawUiaNode {
                    runtime_id: vec![1, 2],
                    role: "button".to_owned(),
                    name: Some("Save".to_owned()),
                    value: None,
                    bounds: Some(self.target.bounds),
                    enabled: true,
                    password: false,
                    focused: false,
                    editable: false,
                    children: Vec::new(),
                }],
            })
        }

        fn capture_window(
            &mut self,
            _target: &WindowTarget,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> Result<CapturedFrame, &'static str> {
            self.capture_calls.set(self.capture_calls.get() + 1);
            Ok(CapturedFrame {
                identity: self.observed_identity,
                bounds: self.target.bounds,
                width: 2,
                height: 1,
                stride: 8,
                bgra: vec![0, 0, 255, 255, 0, 255, 0, 255],
            })
        }
    }

    fn identity(created: u64) -> WindowIdentity {
        WindowIdentity::new(5, 7, created).expect("identity")
    }

    fn permissions() -> PermissionSnapshot {
        PermissionSnapshot {
            uia_available: true,
            capture_available: true,
            desktop: DesktopSecurity::Interactive,
            current_integrity: IntegrityLevel::Medium,
            target_integrity: IntegrityLevel::Medium,
            password_surface: false,
        }
    }

    fn target() -> WindowTarget {
        WindowTarget {
            app_id: "app-7-11".to_owned(),
            app_name: "Fixture".to_owned(),
            window_id: "window-5-7-11".to_owned(),
            title: "Harmless window".to_owned(),
            identity: identity(11),
            bounds: PhysicalRect {
                left: -4,
                top: -2,
                right: -2,
                bottom: -1,
            },
            dpi: Dpi { x: 144, y: 144 },
            permissions: permissions(),
        }
    }

    fn platform(created: u64) -> (WindowsObservationPlatform<FakeWindowsApi>, Rc<Cell<usize>>) {
        let calls = Rc::new(Cell::new(0));
        let api = FakeWindowsApi {
            target: target(),
            observed_identity: identity(created),
            capture_calls: calls.clone(),
        };
        (WindowsObservationPlatform::with_api(api), calls)
    }

    fn request(include_image: bool) -> computer_use_protocol::HelperRequest {
        let decoded = decode_helper_input(json!({
            "protocolVersion":1,
            "messageKind":"request",
            "requestKind":"snapshot",
            "requestId":"00000000-0000-4000-8000-000000000001",
            "sessionId":"session-1",
            "timeoutMs":1000,
            "leaseId":"00000000-0000-4000-8000-000000000002",
            "leaseRevision":1,
            "appId":"app-7-11",
            "windowId":"window-5-7-11",
            "snapshotRevision":9,
            "includeImage":include_image
        }))
        .expect("request");
        let HelperInput::Request(request) = decoded else {
            panic!("request expected")
        };
        request
    }

    fn admit(platform: &mut WindowsObservationPlatform<FakeWindowsApi>) -> Value {
        platform.list(50, &CancellationToken::new()).expect("list")
    }

    #[test]
    fn maps_status_and_groups_only_validated_grantable_windows() {
        let (mut platform, _) = platform(11);
        assert_eq!(
            platform
                .status(50, &CancellationToken::new())
                .expect("status"),
            json!({"viewing":"granted","assistive":"granted","supported":true}),
        );
        assert_eq!(
            admit(&mut platform),
            json!({"apps":[{"appId":"app-7-11","name":"Fixture","windows":[{"windowId":"window-5-7-11","title":"Harmless window"}]}]}),
        );
    }

    #[test]
    fn prepares_semantics_and_optional_exact_window_png_after_list_admission() {
        let (mut platform, capture_calls) = platform(11);
        admit(&mut platform);
        let semantic = platform
            .prepare_snapshot(&request(false), 9, 50, &CancellationToken::new())
            .expect("semantic snapshot");
        assert_eq!(semantic.png, None);
        assert_eq!(capture_calls.get(), 0);
        assert_eq!(
            semantic.result.pointer("/snapshotRevision"),
            Some(&json!(9))
        );
        assert_eq!(
            semantic.result.pointer("/refs/0/role"),
            Some(&json!("button"))
        );
        assert!(
            semantic
                .result
                .pointer("/semanticText")
                .and_then(Value::as_str)
                .is_some_and(|text| text.contains("Save"))
        );

        let captured = platform
            .prepare_snapshot(&request(true), 9, 50, &CancellationToken::new())
            .expect("image snapshot");
        assert_eq!(capture_calls.get(), 1);
        let png = captured.png.expect("PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(
            captured.result.pointer("/image/byteLength"),
            Some(&json!(png.len())),
        );
        assert_eq!(
            captured.result.pointer("/image/transferId"),
            Some(&json!("00000000-0000-4000-8000-000000000001")),
        );
        assert_eq!(
            captured
                .result
                .pointer("/image/sha256")
                .and_then(Value::as_str)
                .map(str::len),
            Some(64),
        );
    }

    #[test]
    fn stale_process_identity_and_permission_denial_have_no_capture_side_effect() {
        let (mut stale, stale_calls) = platform(12);
        admit(&mut stale);
        assert_eq!(
            stale.prepare_snapshot(&request(true), 9, 50, &CancellationToken::new()),
            Err("STALE_REF"),
        );
        assert_eq!(stale_calls.get(), 0);

        let (mut denied, denied_calls) = platform(11);
        denied.api.target.permissions.desktop = DesktopSecurity::Secure;
        admit(&mut denied);
        assert_eq!(
            denied.prepare_snapshot(&request(true), 9, 50, &CancellationToken::new()),
            Err("PERMISSION_DENIED"),
        );
        assert_eq!(denied_calls.get(), 0);
    }

    #[test]
    fn cancellation_and_unknown_targets_fail_before_native_observation() {
        let (mut platform, calls) = platform(11);
        admit(&mut platform);
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert_eq!(
            platform.prepare_snapshot(&request(true), 9, 50, &cancelled),
            Err("CANCELLED")
        );
        assert_eq!(calls.get(), 0);

        #[cfg(not(target_os = "windows"))]
        let native_api = NativeWindowsApi;
        #[cfg(target_os = "windows")]
        let native_api = NativeWindowsApi::new(std::time::Instant::now());
        let mut never_listed = WindowsObservationPlatform::with_api(native_api);
        assert_eq!(
            never_listed.prepare_snapshot(&request(false), 9, 50, &CancellationToken::new()),
            Err("STALE_REF"),
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn native_backend_reports_honest_unavailable_status_without_enumerating_targets() {
        let mut platform = WindowsObservationPlatform::with_api(NativeWindowsApi);
        let cancel = CancellationToken::new();
        assert_eq!(
            platform.status(50, &cancel).expect("status"),
            json!({"viewing":"unknown","assistive":"unknown","supported":false}),
        );
        assert_eq!(
            platform.list(50, &cancel).expect("list"),
            json!({"apps":[]}),
        );
    }
}
