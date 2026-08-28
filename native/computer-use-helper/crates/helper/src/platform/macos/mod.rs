//! macOS 14+ read-only observation using Accessibility and ScreenCaptureKit.

mod accessibility;
mod capture;
mod permissions;
mod scale;

use std::collections::BTreeMap;
use std::mem::{MaybeUninit, size_of};
use std::time::Instant;

use computer_use_core::{
    CancellationToken, ObservationBounds, ObservationPlatform, PlatformResult,
};
use computer_use_protocol::HelperRequest;
use serde_json::json;
use sha2::{Digest, Sha256};

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
}

impl MacObservationPlatform {
    /// Bind native deadlines to the helper's process-local monotonic epoch.
    #[must_use]
    pub fn new(epoch: Instant) -> Self {
        Self {
            epoch,
            pending_png: None,
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
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        self.pending_png = None;
        let (supported, viewing, assistive) = self.precheck(deadline_ms, cancel)?;
        if !supported {
            return Err("NOT_SUPPORTED");
        }
        if !viewing || !assistive {
            return Err("PERMISSION_DENIED");
        }
        let app_id = request.string("appId").ok_or("INTERNAL")?;
        let window_id = request.string("windowId").ok_or("INTERNAL")?;
        let revision = request.integer("snapshotRevision").ok_or("INTERNAL")?;
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
            revision,
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
        let refs = projection
            .refs
            .into_iter()
            .map(|item| json!({"ref":item.ref_id,"role":item.role,"name":item.name}))
            .collect::<Vec<_>>();
        let result = json!({
            "appId": app_id,
            "windowId": window_id,
            "snapshotRevision": revision,
            "semanticText": projection.semantic_text,
            "refs": refs,
        });
        if serde_json::to_vec(&result).map_err(|_| "INTERNAL")?.len() > 65_000 {
            return Err("BINARY_MISMATCH");
        }

        if request.boolean("includeImage") == Some(true) {
            let mut last_error = "BINARY_MISMATCH";
            for attempt in 0..scale::MAX_DOWNSCALE_ATTEMPTS {
                match capture::capture_exact_window(
                    &target,
                    attempt,
                    &self.epoch,
                    deadline_ms,
                    cancel,
                ) {
                    Ok(png) => {
                        self.pending_png = Some(png);
                        return Ok(result);
                    }
                    Err("BINARY_MISMATCH") => last_error = "BINARY_MISMATCH",
                    Err(code) => return Err(code),
                }
            }
            return Err(last_error);
        }
        Ok(result)
    }

    fn take_png(&mut self) -> Option<Vec<u8>> {
        self.pending_png.take()
    }
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
    use super::{ProcBsdInfo, process_identity};

    #[test]
    fn kernel_process_identity_layout_and_lookup_are_exact() {
        assert_eq!(std::mem::size_of::<ProcBsdInfo>(), 136);
        let identity = process_identity(std::process::id() as i32, "test.helper")
            .expect("current process identity");
        assert_eq!(identity.pid, std::process::id() as i32);
        assert!(identity.start_seconds > 0);
    }
}
