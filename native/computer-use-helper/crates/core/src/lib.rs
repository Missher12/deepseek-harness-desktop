//! Platform-neutral monotonic lease enforcement and read-only helper dispatch.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use computer_use_protocol::{ControlMessage, HelperInput, HelperRequest, HelperResponse};
use serde_json::{Value, json};

/// Monotonic time source; wall-clock time is deliberately excluded from lease expiry.
pub trait MonotonicClock {
    /// Monotonic milliseconds from an arbitrary process-local epoch.
    fn now_ms(&self) -> u64;
}

/// Cloneable process-local cancellation signal updated by the high-priority reader path.
#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    /// Create a live request token.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancel the request. Repeated cancellation is idempotent.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Check cancellation between bounded native observation stages.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Narrow read-only platform seam. Implementations receive one immutable deadline.
pub trait ObservationPlatform {
    /// Report platform permission/support state.
    fn status(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult;
    /// Enumerate currently grantable applications and windows.
    fn list(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult;
    /// Capture one already-authorized exact target.
    fn snapshot(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult;
}

/// Closed platform result: success JSON or a protocol error code only.
pub type PlatformResult = std::result::Result<Value, &'static str>;

/// Honest placeholder used until platform capture is implemented in a later task.
#[derive(Clone, Copy, Default)]
pub struct NullObservationPlatform;

impl ObservationPlatform for NullObservationPlatform {
    fn status(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
        Ok(json!({"viewing":"unknown","assistive":"unknown","supported":false}))
    }

    fn list(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
        Ok(json!({"apps":[]}))
    }

    fn snapshot(
        &mut self,
        _request: &HelperRequest,
        _deadline_ms: u64,
        _cancel: &CancellationToken,
    ) -> PlatformResult {
        Err("NOT_SUPPORTED")
    }
}

#[derive(Clone)]
struct Target {
    app_id: String,
    window_ids: Vec<String>,
}

#[derive(Clone)]
struct Quotas {
    operations: u64,
    snapshots: u64,
}

struct Lease {
    revision: u64,
    targets: Vec<Target>,
    quotas: Quotas,
    installed_at_ms: u64,
    last_activity_ms: u64,
    idle_after_ms: u64,
    hard_after_ms: u64,
}

struct ActiveLease {
    session_id: String,
    lease_id: String,
    lease: Lease,
}

impl Lease {
    fn expired(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.last_activity_ms) >= self.idle_after_ms
            || now_ms.saturating_sub(self.installed_at_ms) >= self.hard_after_ms
    }

    fn permits(&self, app_id: &str, window_id: &str) -> bool {
        self.targets.iter().any(|target| {
            target.app_id == app_id
                && target
                    .window_ids
                    .iter()
                    .any(|candidate| candidate == window_id)
        })
    }
}

/// Stateful core owned by exactly one helper process.
pub struct ComputerUseCore<C, P> {
    clock: C,
    platform: P,
    active: Option<ActiveLease>,
    last_revision: u64,
}

impl<C, P> ComputerUseCore<C, P>
where
    C: MonotonicClock,
    P: ObservationPlatform,
{
    /// Construct an empty core. Construction performs no platform work.
    #[must_use]
    pub fn new(clock: C, platform: P) -> Self {
        Self {
            clock,
            platform,
            active: None,
            last_revision: 0,
        }
    }

    /// Dispatch one already strictly decoded helper input.
    pub fn handle(&mut self, input: HelperInput) -> Option<HelperResponse> {
        self.handle_with_cancellation(input, &CancellationToken::new())
    }

    /// Dispatch with a token that the reader thread may cancel during platform work.
    pub fn handle_with_cancellation(
        &mut self,
        input: HelperInput,
        cancel: &CancellationToken,
    ) -> Option<HelperResponse> {
        match input {
            HelperInput::Control(control) => {
                self.handle_control(&control);
                None
            }
            HelperInput::Request(request) => Some(self.handle_request(&request, cancel)),
        }
    }

    /// Visible only for deterministic lifecycle verification.
    #[must_use]
    pub fn active_lease_count(&self) -> usize {
        usize::from(self.active.is_some())
    }

    fn handle_request(
        &mut self,
        request: &HelperRequest,
        cancel: &CancellationToken,
    ) -> HelperResponse {
        if cancel.is_cancelled() {
            return HelperResponse::error(request, "CANCELLED", false);
        }
        let deadline_ms = self.clock.now_ms().saturating_add(request.timeout_ms());
        match request.request_kind() {
            "status" => {
                platform_response(request, self.platform.status(deadline_ms, cancel), cancel)
            }
            "list" => platform_response(request, self.platform.list(deadline_ms, cancel), cancel),
            "lease.install" => self.install_lease(request),
            "snapshot" => self.snapshot(request, deadline_ms, cancel),
            "stop" => self.stop(request),
            "input.release" => HelperResponse::ok(request, json!({"released":true})),
            // Input actions are intentionally absent from this delivery. Never invoke an OS API.
            "focus" | "click" | "double-click" | "drag" | "type" | "key" | "scroll" | "wait" => {
                HelperResponse::error(request, "NOT_SUPPORTED", false)
            }
            _ => HelperResponse::error(request, "NOT_SUPPORTED", false),
        }
    }

    fn install_lease(&mut self, request: &HelperRequest) -> HelperResponse {
        let lease_id = required_string(request, "leaseId");
        let revision = required_integer(request, "leaseRevision");
        if revision <= self.last_revision {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        }
        if self.active.is_some() {
            return HelperResponse::error(request, "BUSY", true);
        }
        let targets = request
            .field("targets")
            .and_then(Value::as_array)
            .expect("validated targets")
            .iter()
            .map(|target| {
                let target = target.as_object().expect("validated target");
                Target {
                    app_id: target["appId"]
                        .as_str()
                        .expect("validated appId")
                        .to_owned(),
                    window_ids: target["windowIds"]
                        .as_array()
                        .expect("validated windowIds")
                        .iter()
                        .map(|value| value.as_str().expect("validated windowId").to_owned())
                        .collect(),
                }
            })
            .collect();
        let quotas = request
            .field("quotas")
            .and_then(Value::as_object)
            .expect("validated quotas");
        let now_ms = self.clock.now_ms();
        let lease = Lease {
            revision,
            targets,
            quotas: Quotas {
                operations: quotas["operations"].as_u64().expect("validated quota"),
                snapshots: quotas["snapshots"].as_u64().expect("validated quota"),
            },
            installed_at_ms: now_ms,
            last_activity_ms: now_ms,
            idle_after_ms: required_integer(request, "idleExpiresAfterMs"),
            hard_after_ms: required_integer(request, "hardExpiresAfterMs"),
        };
        self.last_revision = revision;
        self.active = Some(ActiveLease {
            session_id: request.session_id().to_owned(),
            lease_id: lease_id.to_owned(),
            lease,
        });
        HelperResponse::ok(request, json!({"installed":true,"leaseRevision":revision}))
    }

    fn snapshot(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> HelperResponse {
        let now_ms = self.clock.now_ms();
        let session_id = request.session_id();
        let lease_id = required_string(request, "leaseId");
        let revision = required_integer(request, "leaseRevision");
        let Some(active) = self.active.as_ref() else {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        };
        if active.session_id != session_id
            || active.lease_id != lease_id
            || active.lease.revision != revision
        {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        }
        if active.lease.expired(now_ms) {
            self.active = None;
            return HelperResponse::error(request, "LEASE_EXPIRED", false);
        }
        let lease = &mut self.active.as_mut().expect("active lease checked").lease;
        if !lease.permits(
            required_string(request, "appId"),
            required_string(request, "windowId"),
        ) {
            return HelperResponse::error(request, "UNAUTHORIZED", false);
        }
        if lease.quotas.operations == 0 || lease.quotas.snapshots == 0 {
            return HelperResponse::error(request, "QUOTA_EXCEEDED", false);
        }
        lease.quotas.operations -= 1;
        lease.quotas.snapshots -= 1;
        lease.last_activity_ms = now_ms;
        platform_response(
            request,
            self.platform.snapshot(request, deadline_ms, cancel),
            cancel,
        )
    }

    fn stop(&mut self, request: &HelperRequest) -> HelperResponse {
        let Some(active) = self.active.as_ref() else {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        };
        if active.session_id != request.session_id()
            || active.lease_id != required_string(request, "leaseId")
            || active.lease.revision != required_integer(request, "leaseRevision")
        {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        }
        HelperResponse::ok(request, json!({"stopped":true}))
    }

    fn handle_control(&mut self, control: &ControlMessage) {
        match control.control_kind() {
            "session.revoke" => {
                let Some(session_id) = control.string("sessionId") else {
                    return;
                };
                if self
                    .active
                    .as_ref()
                    .is_some_and(|active| active.session_id == session_id)
                {
                    self.active = None;
                }
            }
            "lease.revoke" => {
                let Some(session_id) = control.string("sessionId") else {
                    return;
                };
                let Some(lease_id) = control.string("leaseId") else {
                    return;
                };
                let Some(revision) = control.integer("leaseRevision") else {
                    return;
                };
                if self.active.as_ref().is_some_and(|active| {
                    active.session_id == session_id
                        && active.lease_id == lease_id
                        && active.lease.revision == revision
                }) {
                    self.active = None;
                }
            }
            "parent.shutdown" => self.active = None,
            "request.cancel" => {}
            _ => {}
        }
    }
}

fn platform_response(
    request: &HelperRequest,
    result: PlatformResult,
    cancel: &CancellationToken,
) -> HelperResponse {
    if cancel.is_cancelled() {
        return HelperResponse::error(request, "CANCELLED", false);
    }
    match result {
        Ok(result) => HelperResponse::ok(request, result),
        Err(code) => HelperResponse::error(request, code, matches!(code, "BUSY" | "TIMEOUT")),
    }
}

fn required_string<'a>(request: &'a HelperRequest, field: &str) -> &'a str {
    request
        .string(field)
        .expect("strict decoder guaranteed string")
}

fn required_integer(request: &HelperRequest, field: &str) -> u64 {
    request
        .integer(field)
        .expect("strict decoder guaranteed integer")
}
