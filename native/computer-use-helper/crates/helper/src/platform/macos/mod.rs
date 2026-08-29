//! macOS 14+ read-only observation using Accessibility and ScreenCaptureKit.

mod accessibility;
mod capture;
mod input;
mod permissions;
mod scale;

use std::collections::BTreeMap;
use std::mem::{MaybeUninit, size_of};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use computer_use_core::{
    CancellationToken, NativeInputCost, ObservationBounds, ObservationPlatform, PlatformResult,
    ProjectedRef,
};
use computer_use_protocol::HelperRequest;
use serde_json::json;
use sha2::{Digest, Sha256};

use input::{
    Button, CoreGraphicsSink, InputCommand, InputController, Point, ensure_safe_input_text,
    ensure_safe_target,
};

pub use permissions::permission_status;

const MAX_LIST_JSON_BYTES: usize = 60_000;
const MAX_APP_NAME_BYTES: usize = 256;
const MAX_WINDOW_TITLE_BYTES: usize = 1_024;

/// Exact process identity used to reject PID reuse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MacProcessIdentity {
    /// Kernel process identifier.
    pub pid: i32,
    /// Kernel-recorded process start time seconds.
    pub start_seconds: u64,
    /// Kernel-recorded process start time microseconds.
    pub start_microseconds: u64,
    /// SCK owner bundle identifier.
    pub bundle_id: String,
}

/// Encode a bounded application identity that changes on process or bundle reuse.
#[must_use]
pub fn encode_app_id(identity: &MacProcessIdentity) -> String {
    let digest = Sha256::digest(identity.bundle_id.as_bytes());
    let bundle_hash = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "mac-app:{}:{}:{}:{bundle_hash}",
        identity.pid, identity.start_seconds, identity.start_microseconds
    )
}

/// Encode one SCK window number under its exact process lifetime.
#[must_use]
pub fn encode_window_id(identity: &MacProcessIdentity, window_id: u32) -> String {
    format!(
        "mac-window:{}:{}:{}:{window_id}",
        identity.pid, identity.start_seconds, identity.start_microseconds
    )
}

#[derive(Clone, Debug)]
pub(crate) struct WindowDescriptor {
    pub(crate) identity: MacProcessIdentity,
    pub(crate) app_name: String,
    pub(crate) window_id: u32,
    pub(crate) title: String,
    pub(crate) bounds: ObservationBounds,
}

impl WindowDescriptor {
    fn app_id(&self) -> String {
        encode_app_id(&self.identity)
    }

    fn encoded_window_id(&self) -> String {
        encode_window_id(&self.identity, self.window_id)
    }

    pub(crate) fn exactly_matches(&self, other: &Self) -> bool {
        self.identity == other.identity
            && self.window_id == other.window_id
            && self.title == other.title
            && close_bounds(self.bounds, other.bounds)
    }
}

/// Stateful macOS observation backend. PNG bytes are single-use and request-local.
pub struct MacObservationPlatform {
    epoch: Instant,
    pending_png: Option<Vec<u8>>,
    latest_snapshot: Option<LiveSnapshot>,
    input: InputController<CoreGraphicsSink>,
}

#[derive(Clone)]
struct LiveSnapshot {
    target: WindowDescriptor,
    revision: u64,
    included_image: bool,
    refs: Vec<ProjectedRef>,
}

impl MacObservationPlatform {
    /// Bind native deadlines to the helper's process-local monotonic epoch.
    #[must_use]
    pub fn new(epoch: Instant) -> Self {
        Self {
            epoch,
            pending_png: None,
            latest_snapshot: None,
            input: InputController::new(CoreGraphicsSink),
        }
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn precheck(
        &self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<(bool, bool, bool), &'static str> {
        if cancel.is_cancelled() {
            return Err("CANCELLED");
        }
        if self.now_ms() >= deadline_ms {
            return Err("TIMEOUT");
        }
        Ok(permissions::preflight())
    }
}

impl ObservationPlatform for MacObservationPlatform {
    fn status(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult {
        let (supported, viewing, assistive) = self.precheck(deadline_ms, cancel)?;
        Ok(permission_status(supported, viewing, assistive))
    }

    fn list(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult {
        let (supported, viewing, assistive) = self.precheck(deadline_ms, cancel)?;
        if !supported {
            return Err("NOT_SUPPORTED");
        }
        if !viewing || !assistive {
            return Err("PERMISSION_DENIED");
        }
        let windows = capture::query_windows(&self.epoch, deadline_ms, cancel)?;
        list_result(windows)
    }

    fn snapshot(
        &mut self,
        request: &HelperRequest,
        snapshot_revision: u64,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        self.pending_png = None;
        self.latest_snapshot = None;
        let (supported, viewing, assistive) = self.precheck(deadline_ms, cancel)?;
        if !supported {
            return Err("NOT_SUPPORTED");
        }
        if !viewing || !assistive {
            return Err("PERMISSION_DENIED");
        }
        let app_id = request.string("appId").ok_or("INTERNAL")?;
        let window_id = request.string("windowId").ok_or("INTERNAL")?;
        let windows = capture::query_windows(&self.epoch, deadline_ms, cancel)?;
        let mut matching = windows
            .into_iter()
            .filter(|window| window.app_id() == app_id && window.encoded_window_id() == window_id);
        let target = matching.next().ok_or("TARGET_CLOSED")?;
        if matching.next().is_some() {
            return Err("TARGET_CLOSED");
        }
        if process_identity(target.identity.pid, &target.identity.bundle_id).as_ref()
            != Some(&target.identity)
        {
            return Err("TARGET_CLOSED");
        }

        let projection = accessibility::observe_exact_window(
            &target,
            app_id,
            window_id,
            snapshot_revision,
            &self.epoch,
            deadline_ms,
            cancel,
        )?;
        let refreshed = capture::query_windows(&self.epoch, deadline_ms, cancel)?;
        if refreshed
            .iter()
            .filter(|window| window.exactly_matches(&target))
            .count()
            != 1
        {
            return Err("TARGET_CLOSED");
        }
        let projected_refs = projection.refs.clone();
        let refs = projection
            .refs
            .iter()
            .map(|item| json!({"ref":item.ref_id,"role":item.role,"name":item.name}))
            .collect::<Vec<_>>();
        let result = json!({
            "appId": app_id,
            "windowId": window_id,
            "snapshotRevision": snapshot_revision,
            "semanticText": projection.semantic_text,
            "refs": refs,
        });
        if serde_json::to_vec(&result).map_err(|_| "INTERNAL")?.len() > 65_000 {
            return Err("BINARY_MISMATCH");
        }

        let included_image = request.boolean("includeImage") == Some(true);
        if included_image {
            let mut last_error = "BINARY_MISMATCH";
            let mut captured = None;
            for attempt in 0..scale::MAX_DOWNSCALE_ATTEMPTS {
                match capture::capture_exact_window(
                    &target,
                    attempt,
                    &self.epoch,
                    deadline_ms,
                    cancel,
                ) {
                    Ok(png) => {
                        captured = Some(png);
                        break;
                    }
                    Err("BINARY_MISMATCH") => last_error = "BINARY_MISMATCH",
                    Err(code) => return Err(code),
                }
            }
            let Some(png) = captured else {
                return Err(last_error);
            };
            self.pending_png = Some(png);
        }
        self.latest_snapshot = Some(LiveSnapshot {
            target,
            revision: snapshot_revision,
            included_image,
            refs: projected_refs,
        });
        Ok(result)
    }

    fn input(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
        permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> PlatformResult {
        let snapshot = self.latest_snapshot.clone().ok_or("STALE_REF")?;
        if snapshot.revision != request.integer("snapshotRevision").ok_or("INTERNAL")?
            || snapshot.target.app_id() != request.string("appId").ok_or("INTERNAL")?
            || snapshot.target.encoded_window_id()
                != request.string("windowId").ok_or("INTERNAL")?
        {
            return Err("STALE_REF");
        }
        ensure_safe_target(&snapshot.target.app_name, &snapshot.target.title)?;

        if request.request_kind() == "wait" {
            permit(NativeInputCost::operation())?;
            wait_exact(
                &snapshot,
                request.integer("durationMs").ok_or("INTERNAL")?,
                &self.epoch,
                deadline_ms,
                cancel,
            )?;
            return Ok(json!({"waited":true,"snapshotRevision":snapshot.revision}));
        }

        let (command, expected_ref, validation) = input_command(request, &snapshot)?;
        let epoch = self.epoch;
        let validation_snapshot = snapshot.clone();
        let mut validate = || {
            validate_live(
                &validation_snapshot,
                expected_ref.as_ref(),
                validation,
                &epoch,
                deadline_ms,
                cancel,
            )
        };
        self.input
            .execute(snapshot.target.identity.pid, command, &mut validate, permit)?;
        Ok(json!({"acted":true,"snapshotRevision":snapshot.revision}))
    }

    fn release_input(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        check_deadline(&self.epoch, deadline_ms, cancel)?;
        let keys = request
            .field("keys")
            .and_then(serde_json::Value::as_array)
            .ok_or("INTERNAL")?
            .iter()
            .map(|item| item.as_str().map(ToOwned::to_owned).ok_or("INTERNAL"))
            .collect::<Result<Vec<_>, _>>()?;
        let buttons = request
            .field("buttons")
            .and_then(serde_json::Value::as_array)
            .ok_or("INTERNAL")?
            .iter()
            .map(|item| Button::parse(item.as_str().ok_or("INTERNAL")?))
            .collect::<Result<Vec<_>, _>>()?;
        self.input.release_requested(&keys, &buttons)?;
        check_deadline(&self.epoch, deadline_ms, cancel)?;
        Ok(json!({"released":true}))
    }

    fn release_all_input(
        &mut self,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> Result<(), &'static str> {
        check_deadline(&self.epoch, deadline_ms, cancel)?;
        self.input.release_all()
    }

    fn take_png(&mut self) -> Option<Vec<u8>> {
        self.pending_png.take()
    }
}

fn input_command(
    request: &HelperRequest,
    snapshot: &LiveSnapshot,
) -> Result<(InputCommand, Option<ProjectedRef>, LiveValidation), &'static str> {
    let semantic_ref = || -> Result<ProjectedRef, &'static str> {
        let ref_id = request.string("ref").ok_or("INTERNAL")?;
        let reference = snapshot
            .refs
            .iter()
            .find(|item| item.ref_id == ref_id)
            .cloned()
            .ok_or("STALE_REF")?;
        ensure_safe_input_text(
            &snapshot.target.app_name,
            &snapshot.target.title,
            &reference.role,
            &reference.name,
        )?;
        if reference.input_safety.sensitive {
            return Err("POLICY_DENIED");
        }
        Ok(reference)
    };
    match request.request_kind() {
        "focus" => Ok((
            InputCommand::Focus(Point {
                x: snapshot.target.bounds.x + snapshot.target.bounds.width / 2.0,
                y: snapshot.target.bounds.y + snapshot.target.bounds.height.min(24.0) / 2.0,
            }),
            None,
            LiveValidation::default(),
        )),
        "click" | "double-click" => {
            let button = Button::parse(request.string("button").ok_or("INTERNAL")?)?;
            let (point, reference) = if request.string("ref").is_some() {
                let reference = semantic_ref()?;
                if !pointer_role(&reference.role) {
                    return Err("POLICY_DENIED");
                }
                (
                    semantic_center(reference.bounds, snapshot.target.bounds)?,
                    Some(reference),
                )
            } else {
                require_visual(snapshot)?;
                (request_target_point(request, "x", "y", snapshot)?, None)
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
                LiveValidation::default(),
            ))
        }
        "drag" => {
            require_visual(snapshot)?;
            Ok((
                InputCommand::Drag {
                    from: request_target_point(request, "fromX", "fromY", snapshot)?,
                    to: request_target_point(request, "toX", "toY", snapshot)?,
                    button: Button::parse(request.string("button").ok_or("INTERNAL")?)?,
                },
                None,
                LiveValidation::default(),
            ))
        }
        "type" => {
            let reference = semantic_ref()?;
            if !reference.input_safety.editable {
                return Err("POLICY_DENIED");
            }
            let text = request.string("text").ok_or("INTERNAL")?;
            if text.is_empty() {
                return Err("POLICY_DENIED");
            }
            Ok((
                InputCommand::Unicode(text.to_owned()),
                Some(reference),
                LiveValidation {
                    require_focused: true,
                    allow_ref_mutation: true,
                    ..LiveValidation::default()
                },
            ))
        }
        "key" => {
            let modifiers = request
                .field("modifiers")
                .and_then(serde_json::Value::as_array)
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
                LiveValidation {
                    inspect_focused: true,
                    ..LiveValidation::default()
                },
            ))
        }
        "scroll" => {
            let (point, reference) = if request.string("ref").is_some() {
                let reference = semantic_ref()?;
                if !scroll_role(&reference.role) {
                    return Err("POLICY_DENIED");
                }
                (
                    semantic_center(reference.bounds, snapshot.target.bounds)?,
                    Some(reference),
                )
            } else {
                require_visual(snapshot)?;
                (request_target_point(request, "x", "y", snapshot)?, None)
            };
            Ok((
                InputCommand::Scroll {
                    point,
                    delta_x: request_delta(request, "deltaX")?,
                    delta_y: request_delta(request, "deltaY")?,
                },
                reference,
                LiveValidation::default(),
            ))
        }
        _ => Err("NOT_SUPPORTED"),
    }
}

#[derive(Clone, Copy, Default)]
struct LiveValidation {
    require_focused: bool,
    inspect_focused: bool,
    allow_ref_mutation: bool,
}

fn validate_live(
    snapshot: &LiveSnapshot,
    expected_ref: Option<&ProjectedRef>,
    validation: LiveValidation,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    check_deadline(epoch, deadline_ms, cancel)?;
    if process_identity(
        snapshot.target.identity.pid,
        &snapshot.target.identity.bundle_id,
    )
    .as_ref()
        != Some(&snapshot.target.identity)
    {
        return Err("TARGET_CLOSED");
    }
    let refreshed = capture::query_windows(epoch, deadline_ms, cancel)?;
    if refreshed
        .iter()
        .filter(|window| window.exactly_matches(&snapshot.target))
        .count()
        != 1
    {
        return Err("STALE_REF");
    }
    ensure_safe_target(&snapshot.target.app_name, &snapshot.target.title)?;
    if expected_ref.is_some() || validation.inspect_focused {
        let projection = accessibility::observe_exact_window(
            &snapshot.target,
            &snapshot.target.app_id(),
            &snapshot.target.encoded_window_id(),
            snapshot.revision,
            epoch,
            deadline_ms,
            cancel,
        )?;
        if validation.inspect_focused && projection.focused_sensitive {
            return Err("POLICY_DENIED");
        }
        let Some(expected) = expected_ref else {
            return Ok(());
        };
        let current = projection
            .refs
            .iter()
            .find(|item| item.ref_id == expected.ref_id)
            .ok_or("STALE_REF")?;
        if !reference_matches(expected, current, validation.allow_ref_mutation) {
            return Err("STALE_REF");
        }
        ensure_safe_input_text(
            &snapshot.target.app_name,
            &snapshot.target.title,
            &current.role,
            &current.name,
        )?;
        if current.input_safety.sensitive
            || (validation.require_focused
                && (!current.input_safety.editable || !current.input_safety.focused))
        {
            return Err("POLICY_DENIED");
        }
    }
    Ok(())
}

fn reference_matches(
    expected: &ProjectedRef,
    current: &ProjectedRef,
    allow_mutable_details: bool,
) -> bool {
    expected.ref_id == current.ref_id
        && expected.role == current.role
        && expected.input_safety.sensitive == current.input_safety.sensitive
        && expected.input_safety.editable == current.input_safety.editable
        && (allow_mutable_details
            || (expected.name == current.name && close_bounds(expected.bounds, current.bounds)))
}

fn wait_exact(
    snapshot: &LiveSnapshot,
    duration_ms: u64,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    let end_ms = u64::try_from(epoch.elapsed().as_millis())
        .unwrap_or(u64::MAX)
        .saturating_add(duration_ms);
    loop {
        validate_live(
            snapshot,
            None,
            LiveValidation::default(),
            epoch,
            deadline_ms,
            cancel,
        )?;
        let now_ms = u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        if now_ms >= end_ms {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(end_ms.saturating_sub(now_ms).min(5)));
    }
}

fn check_deadline(
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

fn request_target_point(
    request: &HelperRequest,
    x_field: &str,
    y_field: &str,
    snapshot: &LiveSnapshot,
) -> Result<Point, &'static str> {
    let point = Point {
        x: request
            .field(x_field)
            .and_then(serde_json::Value::as_f64)
            .ok_or("INTERNAL")?,
        y: request
            .field(y_field)
            .and_then(serde_json::Value::as_f64)
            .ok_or("INTERNAL")?,
    };
    let bounds = snapshot.target.bounds;
    if point.x < bounds.x
        || point.y < bounds.y
        || point.x > bounds.x + bounds.width
        || point.y > bounds.y + bounds.height
    {
        return Err("POLICY_DENIED");
    }
    Ok(point)
}

fn request_delta(request: &HelperRequest, field: &str) -> Result<i32, &'static str> {
    let value = request
        .field(field)
        .and_then(serde_json::Value::as_f64)
        .ok_or("INTERNAL")?;
    if !value.is_finite() || value.abs() > 1_000_000.0 {
        return Err("POLICY_DENIED");
    }
    Ok(value.round() as i32)
}

fn require_visual(snapshot: &LiveSnapshot) -> Result<(), &'static str> {
    snapshot.included_image.then_some(()).ok_or("POLICY_DENIED")
}

fn semantic_center(
    bounds: ObservationBounds,
    window: ObservationBounds,
) -> Result<Point, &'static str> {
    let left = bounds.x.max(window.x);
    let top = bounds.y.max(window.y);
    let right = (bounds.x + bounds.width).min(window.x + window.width);
    let bottom = (bounds.y + bounds.height).min(window.y + window.height);
    if left >= right || top >= bottom {
        return Err("STALE_REF");
    }
    Ok(Point {
        x: (left + right) / 2.0,
        y: (top + bottom) / 2.0,
    })
}

fn pointer_role(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "axbutton"
            | "axcheckbox"
            | "axradiobutton"
            | "axmenuitem"
            | "axpopupbutton"
            | "axlink"
            | "axtab"
            | "axtextfield"
            | "axtextarea"
    )
}

fn scroll_role(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "axscrollarea" | "axlist" | "axtable" | "axoutline" | "axtextarea"
    )
}

fn list_result(windows: Vec<WindowDescriptor>) -> PlatformResult {
    #[derive(Default)]
    struct App {
        name: String,
        windows: Vec<(String, String)>,
    }

    let mut grouped: BTreeMap<String, App> = BTreeMap::new();
    let mut budget = 32_usize;
    for window in windows {
        let app_id = window.app_id();
        let window_id = window.encoded_window_id();
        let name = truncate_utf8(&window.app_name, MAX_APP_NAME_BYTES);
        let title = truncate_utf8(&window.title, MAX_WINDOW_TITLE_BYTES);
        let additional = app_id.len() + window_id.len() + name.len() + title.len() + 96;
        if budget.saturating_add(additional) > MAX_LIST_JSON_BYTES {
            continue;
        }
        if !grouped.contains_key(&app_id) && grouped.len() >= 128 {
            continue;
        }
        let app = grouped.entry(app_id).or_insert_with(|| App {
            name,
            windows: Vec::new(),
        });
        if app.windows.len() >= 256 {
            continue;
        }
        app.windows.push((window_id, title));
        budget += additional;
    }
    let apps = grouped
        .into_iter()
        .map(|(app_id, mut app)| {
            app.windows.sort();
            json!({
                "appId": app_id,
                "name": app.name,
                "windows": app.windows.into_iter().map(|(window_id, title)| {
                    json!({"windowId":window_id,"title":title})
                }).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    let result = json!({"apps":apps});
    if serde_json::to_vec(&result).map_err(|_| "INTERNAL")?.len() > 65_536 {
        return Err("BINARY_MISMATCH");
    }
    Ok(result)
}

pub(crate) fn process_identity(pid: i32, bundle_id: &str) -> Option<MacProcessIdentity> {
    if pid <= 0 || bundle_id.is_empty() {
        return None;
    }
    let mut info = MaybeUninit::<ProcBsdInfo>::zeroed();
    // SAFETY: The buffer is exactly the documented PROC_PIDTBSDINFO structure.
    let written = unsafe {
        proc_pidinfo(
            pid,
            3,
            0,
            info.as_mut_ptr().cast(),
            size_of::<ProcBsdInfo>() as i32,
        )
    };
    if written != size_of::<ProcBsdInfo>() as i32 {
        return None;
    }
    // SAFETY: proc_pidinfo reported that it initialized the entire structure.
    let info = unsafe { info.assume_init() };
    if info.pbi_pid != pid as u32 || info.pbi_start_tvsec == 0 {
        return None;
    }
    Some(MacProcessIdentity {
        pid,
        start_seconds: info.pbi_start_tvsec,
        start_microseconds: info.pbi_start_tvusec,
        bundle_id: bundle_id.to_owned(),
    })
}

fn close_bounds(left: ObservationBounds, right: ObservationBounds) -> bool {
    (left.x - right.x).abs() <= 0.5
        && (left.y - right.y).abs() <= 0.5
        && (left.width - right.width).abs() <= 0.5
        && (left.height - right.height).abs() <= 0.5
}

fn truncate_utf8(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_owned();
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

#[repr(C)]
struct ProcBsdInfo {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: u32,
    pbi_gid: u32,
    pbi_ruid: u32,
    pbi_rgid: u32,
    pbi_svuid: u32,
    pbi_svgid: u32,
    rfu_1: u32,
    pbi_comm: [libc::c_char; 16],
    pbi_name: [libc::c_char; 32],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

unsafe extern "C" {
    fn proc_pidinfo(
        pid: i32,
        flavor: i32,
        arg: u64,
        buffer: *mut libc::c_void,
        buffer_size: i32,
    ) -> i32;
}

#[cfg(test)]
mod tests {
    use computer_use_core::{InputSafety, ObservationBounds, ProjectedRef};

    use super::{ProcBsdInfo, process_identity, reference_matches};

    #[test]
    fn kernel_process_identity_layout_and_lookup_are_exact() {
        assert_eq!(std::mem::size_of::<ProcBsdInfo>(), 136);
        let identity = process_identity(std::process::id() as i32, "test.helper")
            .expect("current process identity");
        assert_eq!(identity.pid, std::process::id() as i32);
        assert!(identity.start_seconds > 0);
    }

    #[test]
    fn unicode_revalidation_allows_own_text_mutation_but_not_security_drift() {
        let expected = ProjectedRef {
            ref_id: "computer:stable".into(),
            role: "AXTextField".into(),
            name: "Address and search".into(),
            bounds: ObservationBounds {
                x: 10.0,
                y: 10.0,
                width: 400.0,
                height: 30.0,
            },
            input_safety: InputSafety {
                sensitive: false,
                editable: true,
                focused: true,
            },
        };
        let mut changed = expected.clone();
        changed.name = "https://example.com".into();
        changed.bounds.width = 420.0;

        assert!(reference_matches(&expected, &changed, true));
        assert!(!reference_matches(&expected, &changed, false));
        changed.input_safety.sensitive = true;
        assert!(!reference_matches(&expected, &changed, true));
    }
}
