//! Platform-neutral monotonic lease enforcement and read-only helper dispatch.

use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use computer_use_protocol::{ControlMessage, HelperInput, HelperRequest, HelperResponse};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Maximum Accessibility traversal depth, including a depth-zero root.
pub const MAX_ACCESSIBILITY_DEPTH: u8 = 32;
/// Maximum native nodes inspected for one snapshot.
pub const MAX_RAW_ACCESSIBILITY_NODES: usize = 2_000;
/// Maximum semantic references returned for one snapshot.
pub const MAX_SEMANTIC_REFS: usize = 300;
/// Maximum UTF-8 semantic text bytes returned for one snapshot.
pub const MAX_SEMANTIC_TEXT_BYTES: usize = 49_152;
/// Maximum UTF-8 role bytes retained per reference.
pub const MAX_ROLE_BYTES: usize = 128;
/// Maximum UTF-8 accessible-name bytes retained per reference.
pub const MAX_NAME_BYTES: usize = 1_024;
/// Maximum screenshot edge in pixels.
pub const MAX_CAPTURE_EDGE: u32 = 2_048;
/// Maximum screenshot pixel count.
pub const MAX_CAPTURE_PIXELS: u64 = 4_194_304;

const MAX_PROJECTED_JSON_BYTES: usize = 55_000;

/// A finite native rectangle in desktop points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ObservationBounds {
    /// Desktop-space origin on the x axis.
    pub x: f64,
    /// Desktop-space origin on the y axis.
    pub y: f64,
    /// Width in desktop points.
    pub width: f64,
    /// Height in desktop points.
    pub height: f64,
}

impl ObservationBounds {
    fn valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }

    fn intersects(self, other: Self) -> bool {
        self.valid()
            && other.valid()
            && self.x < other.x + other.width
            && other.x < self.x + self.width
            && self.y < other.y + other.height
            && other.y < self.y + self.height
    }
}

/// Safe attributes required by the platform-neutral accessibility projector.
///
/// Platform implementations deliberately must not provide an editable value.
pub struct AccessibilityNode<N> {
    /// Bounded semantic role source.
    pub role: String,
    /// Bounded accessible title/description source, never an input value.
    pub name: String,
    /// Element bounds, when exposed by the platform.
    pub bounds: Option<ObservationBounds>,
    /// Whether the element or its application is hidden.
    pub hidden: bool,
    /// Whether the element is minimized.
    pub minimized: bool,
    /// Conservative input classification derived without reading an editable value.
    pub input_safety: InputSafety,
    /// Child nodes in native order.
    pub children: Vec<N>,
}

/// Safe structural input facts. Unknown elements remain non-editable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputSafety {
    /// A secure, private, or high-impact element that must never receive input.
    pub sensitive: bool,
    /// A known ordinary editable role eligible for Unicode entry when focused.
    pub editable: bool,
    /// Whether AX reports this exact element as the current keyboard focus.
    pub focused: bool,
}

/// Read-only, fakeable native accessibility seam.
pub trait AccessibilityNodeSource {
    /// Opaque, cloneable native node handle.
    type Node: Clone;

    /// Read only safe structural attributes for one node.
    fn describe(
        &mut self,
        node: &Self::Node,
    ) -> std::result::Result<AccessibilityNode<Self::Node>, &'static str>;
}

/// Exact identity and geometry bound to one projection.
pub struct ProjectionScope<'a> {
    /// Exact process-stable application identity.
    pub app_id: &'a str,
    /// Exact process-stable native window identity.
    pub window_id: &'a str,
    /// Caller-selected snapshot revision.
    pub snapshot_revision: u64,
    /// Exact selected window bounds.
    pub window_bounds: ObservationBounds,
}

/// One bounded semantic reference.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectedRef {
    /// Stable opaque reference for this exact target and revision.
    pub ref_id: String,
    /// Truncated safe role.
    pub role: String,
    /// Truncated safe accessible name.
    pub name: String,
    /// Exact visible desktop-space bounds used for semantic pointer actions.
    pub bounds: ObservationBounds,
    /// Conservative input classification, never derived from AXValue.
    pub input_safety: InputSafety,
}

/// Output of one bounded breadth-first projection.
pub struct AccessibilityProjection {
    /// Compact text representation including geometry.
    pub semantic_text: String,
    /// Bounded structured references.
    pub refs: Vec<ProjectedRef>,
    /// Number of raw nodes inspected, including skipped nodes.
    pub raw_nodes: usize,
    /// Whether any inspected non-hidden element is both focused and sensitive.
    pub focused_sensitive: bool,
}

/// Project an accessibility tree with fixed fail-closed bounds.
pub fn project_accessibility_tree<S>(
    source: &mut S,
    root: S::Node,
    scope: ProjectionScope<'_>,
    cancel: &CancellationToken,
) -> PlatformResultProjection
where
    S: AccessibilityNodeSource,
{
    if !scope.window_bounds.valid() {
        return Err("TARGET_CLOSED");
    }
    let mut queue = VecDeque::from([(root, 0_u8)]);
    let mut semantic_text = String::new();
    let mut refs = Vec::new();
    let mut raw_nodes = 0_usize;
    let mut focused_sensitive = false;

    while let Some((node, depth)) = queue.pop_front() {
        if cancel.is_cancelled() {
            return Err("CANCELLED");
        }
        if raw_nodes >= MAX_RAW_ACCESSIBILITY_NODES {
            break;
        }
        raw_nodes += 1;
        let described = source.describe(&node)?;
        focused_sensitive |= described.input_safety.focused && described.input_safety.sensitive;
        let visible_bounds = described
            .bounds
            .filter(|bounds| bounds.intersects(scope.window_bounds));
        if described.hidden || described.minimized || visible_bounds.is_none() {
            continue;
        }
        if depth < MAX_ACCESSIBILITY_DEPTH {
            let remaining = MAX_RAW_ACCESSIBILITY_NODES
                .saturating_sub(raw_nodes)
                .saturating_sub(queue.len());
            queue.extend(
                described
                    .children
                    .into_iter()
                    .take(remaining)
                    .map(|child| (child, depth.saturating_add(1))),
            );
        }
        if refs.len() >= MAX_SEMANTIC_REFS {
            continue;
        }

        let role = truncate_utf8(&described.role, MAX_ROLE_BYTES);
        let name = truncate_utf8(&described.name, MAX_NAME_BYTES);
        let bounds = visible_bounds.expect("visible bounds checked");
        let ref_id = computer_ref(
            scope.app_id,
            scope.window_id,
            scope.snapshot_revision,
            refs.len(),
        );
        let line = format!(
            "[ref={ref_id}] role={} name={} bounds={},{},{},{}\n",
            sanitize_text(&role),
            sanitize_text(&name),
            format_coordinate(bounds.x),
            format_coordinate(bounds.y),
            format_coordinate(bounds.width),
            format_coordinate(bounds.height),
        );
        let projected_size = semantic_text
            .len()
            .saturating_add(line.len())
            .saturating_add(
                refs.iter()
                    .map(|item: &ProjectedRef| {
                        item.ref_id.len() + item.role.len() + item.name.len() + 40
                    })
                    .sum::<usize>(),
            )
            .saturating_add(ref_id.len() + role.len() + name.len() + 40);
        if projected_size > MAX_PROJECTED_JSON_BYTES {
            continue;
        }
        push_truncated(&mut semantic_text, &line, MAX_SEMANTIC_TEXT_BYTES);
        refs.push(ProjectedRef {
            ref_id,
            role,
            name,
            bounds,
            input_safety: described.input_safety,
        });
    }

    Ok(AccessibilityProjection {
        semantic_text,
        refs,
        raw_nodes,
        focused_sensitive,
    })
}

/// Projection-specific result alias with protocol error codes only.
pub type PlatformResultProjection = std::result::Result<AccessibilityProjection, &'static str>;

fn computer_ref(app_id: &str, window_id: &str, revision: u64, index: usize) -> String {
    let mut digest = Sha256::new();
    digest.update(app_id.as_bytes());
    digest.update([0]);
    digest.update(window_id.as_bytes());
    digest.update([0]);
    digest.update(revision.to_be_bytes());
    digest.update((index as u64).to_be_bytes());
    let digest = digest.finalize();
    let suffix = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("computer:{suffix}")
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

fn sanitize_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn push_truncated(output: &mut String, value: &str, maximum: usize) {
    let remaining = maximum.saturating_sub(output.len());
    if remaining == 0 {
        return;
    }
    let mut end = remaining.min(value.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    output.push_str(&value[..end]);
}

fn format_coordinate(value: f64) -> String {
    format!("{:.0}", value)
}

/// Convert point geometry and backing scale to deterministic bounded pixels.
#[must_use]
pub fn capture_dimensions(bounds: ObservationBounds, scale: f64) -> Option<(u32, u32)> {
    if !bounds.valid() || !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let source_width = bounds.width * scale;
    let source_height = bounds.height * scale;
    if !source_width.is_finite() || !source_height.is_finite() {
        return None;
    }
    let edge_scale = (f64::from(MAX_CAPTURE_EDGE) / source_width)
        .min(f64::from(MAX_CAPTURE_EDGE) / source_height)
        .min(1.0);
    let pixel_scale = ((MAX_CAPTURE_PIXELS as f64) / (source_width * source_height))
        .sqrt()
        .min(1.0);
    let reduction = edge_scale.min(pixel_scale);
    let width = (source_width * reduction).round().max(1.0) as u32;
    let height = (source_height * reduction).round().max(1.0) as u32;
    Some((width.min(MAX_CAPTURE_EDGE), height.min(MAX_CAPTURE_EDGE)))
}

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

/// One quota charge committed immediately before a native input event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeInputCost {
    /// Pointer-event units consumed by this native call.
    pub pointer_events: u64,
    /// Key-event units consumed by this native call.
    pub key_events: u64,
    /// UTF-8 text bytes carried by this native call.
    pub text_bytes: u64,
}

impl NativeInputCost {
    /// Charge one pointer event.
    #[must_use]
    pub const fn pointer() -> Self {
        Self {
            pointer_events: 1,
            key_events: 0,
            text_bytes: 0,
        }
    }

    /// Charge one key event and optional Unicode payload bytes.
    #[must_use]
    pub const fn key(text_bytes: u64) -> Self {
        Self {
            pointer_events: 0,
            key_events: 1,
            text_bytes,
        }
    }

    /// Charge one lease-scoped operation that emits no input event.
    #[must_use]
    pub const fn operation() -> Self {
        Self {
            pointer_events: 0,
            key_events: 0,
            text_bytes: 0,
        }
    }
}

/// Narrow native platform seam. Implementations receive one immutable deadline.
pub trait ObservationPlatform {
    /// Report platform permission/support state.
    fn status(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult;
    /// Enumerate currently grantable applications and windows.
    fn list(&mut self, deadline_ms: u64, cancel: &CancellationToken) -> PlatformResult;
    /// Capture one already-authorized exact target.
    fn snapshot(
        &mut self,
        request: &HelperRequest,
        snapshot_revision: u64,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult;

    /// Execute one closed input request and call `permit` immediately before every native event.
    fn input(
        &mut self,
        _request: &HelperRequest,
        _deadline_ms: u64,
        _cancel: &CancellationToken,
        _permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> PlatformResult {
        Err("NOT_SUPPORTED")
    }

    /// Emit only requested key/button-up events without requiring a lease.
    fn release_input(
        &mut self,
        _request: &HelperRequest,
        _deadline_ms: u64,
        _cancel: &CancellationToken,
    ) -> PlatformResult {
        Err("NOT_SUPPORTED")
    }

    /// Release every key/button still held by this helper before teardown acknowledgement.
    fn release_all_input(
        &mut self,
        _deadline_ms: u64,
        _cancel: &CancellationToken,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    /// Take the exact PNG produced by the immediately preceding successful snapshot.
    fn take_png(&mut self) -> Option<Vec<u8>> {
        None
    }
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
        _snapshot_revision: u64,
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
    pointer_actions: u64,
    key_actions: u64,
    text_bytes: u64,
}

struct Lease {
    revision: u64,
    targets: Vec<Target>,
    capabilities: HashSet<String>,
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

struct RevokedLeaseIdentity {
    session_id: String,
    lease_id: String,
    revision: u64,
}

impl RevokedLeaseIdentity {
    fn from_active(active: &ActiveLease) -> Self {
        Self {
            session_id: active.session_id.clone(),
            lease_id: active.lease_id.clone(),
            revision: active.lease.revision,
        }
    }

    fn matches(&self, request: &HelperRequest) -> bool {
        self.session_id == request.session_id()
            && self.lease_id == required_string(request, "leaseId")
            && self.revision == required_integer(request, "leaseRevision")
    }
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
    last_revoked: Option<RevokedLeaseIdentity>,
    last_revision: u64,
    last_snapshot_revision: u64,
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
            last_revoked: None,
            last_revision: 0,
            last_snapshot_revision: 0,
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
            "status" => platform_response(
                request,
                self.platform.status(deadline_ms, cancel),
                cancel,
                None,
            ),
            "list" => platform_response(
                request,
                self.platform.list(deadline_ms, cancel),
                cancel,
                None,
            ),
            "lease.install" => self.install_lease(request),
            "snapshot" => self.snapshot(request, deadline_ms, cancel),
            "stop" => self.stop(request, deadline_ms, cancel),
            "input.release" => platform_response(
                request,
                self.platform.release_input(request, deadline_ms, cancel),
                cancel,
                None,
            ),
            "focus" | "click" | "double-click" | "drag" | "type" | "key" | "scroll" | "wait" => {
                self.input(request, deadline_ms, cancel)
            }
            _ => HelperResponse::error(request, "NOT_SUPPORTED", false),
        }
    }

    fn install_lease(&mut self, request: &HelperRequest) -> HelperResponse {
        self.expire_active(self.clock.now_ms());
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
        let capabilities = request
            .field("capabilities")
            .and_then(Value::as_array)
            .expect("validated capabilities")
            .iter()
            .map(|value| value.as_str().expect("validated capability").to_owned())
            .collect();
        let now_ms = self.clock.now_ms();
        let lease = Lease {
            revision,
            targets,
            capabilities,
            quotas: Quotas {
                operations: quotas["operations"].as_u64().expect("validated quota"),
                snapshots: quotas["snapshots"].as_u64().expect("validated quota"),
                pointer_actions: quotas["pointerActions"].as_u64().expect("validated quota"),
                key_actions: quotas["keyActions"].as_u64().expect("validated quota"),
                text_bytes: quotas["textBytes"].as_u64().expect("validated quota"),
            },
            installed_at_ms: now_ms,
            last_activity_ms: now_ms,
            idle_after_ms: required_integer(request, "idleExpiresAfterMs"),
            hard_after_ms: required_integer(request, "hardExpiresAfterMs"),
        };
        self.last_revision = revision;
        self.last_revoked = None;
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
        let lease = match self.active_lease_for(request, now_ms) {
            Ok(lease) => lease,
            Err(code) => return HelperResponse::error(request, code, false),
        };
        if !lease.capabilities.contains("observe") {
            return HelperResponse::error(request, "UNAUTHORIZED", false);
        }
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
        let Some(snapshot_revision) = self
            .last_snapshot_revision
            .checked_add(1)
            .filter(|revision| *revision <= 9_007_199_254_740_991)
        else {
            return HelperResponse::error(request, "INTERNAL", false);
        };
        self.last_snapshot_revision = snapshot_revision;
        let result = self
            .platform
            .snapshot(request, snapshot_revision, deadline_ms, cancel);
        let png = self.platform.take_png();
        platform_response(request, result, cancel, png)
    }

    fn stop(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> HelperResponse {
        if self.active.is_none() {
            if self
                .last_revoked
                .as_ref()
                .is_some_and(|revoked| revoked.matches(request))
            {
                return match self.platform.release_all_input(deadline_ms, cancel) {
                    Ok(()) => HelperResponse::ok(request, json!({"stopped":true})),
                    Err(code) => HelperResponse::error(request, code, false),
                };
            }
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        }
        if let Err(code) = self.active_lease_for(request, self.clock.now_ms()) {
            return HelperResponse::error(request, code, false);
        }
        let active = self.active.take().expect("active lease checked");
        self.last_revoked = Some(RevokedLeaseIdentity::from_active(&active));
        match self.platform.release_all_input(deadline_ms, cancel) {
            Ok(()) => HelperResponse::ok(request, json!({"stopped":true})),
            Err(code) => HelperResponse::error(request, code, false),
        }
    }

    fn input(
        &mut self,
        request: &HelperRequest,
        deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> HelperResponse {
        let now_ms = self.clock.now_ms();
        if let Some(expired) = self.expire_active(now_ms) {
            return HelperResponse::error(
                request,
                if active_matches(&expired, request) {
                    "LEASE_EXPIRED"
                } else {
                    "LEASE_REVOKED"
                },
                false,
            );
        }
        let Some(active) = self.active.as_mut() else {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        };
        if !active_matches(active, request) {
            return HelperResponse::error(request, "LEASE_REVOKED", false);
        }
        let lease = &mut active.lease;
        if !lease.permits(
            required_string(request, "appId"),
            required_string(request, "windowId"),
        ) {
            return HelperResponse::error(request, "UNAUTHORIZED", false);
        }
        let kind = request.request_kind();
        let capability = match kind {
            "focus" | "click" | "double-click" | "drag" | "scroll" => "pointer",
            "type" | "key" => "keyboard",
            "wait" => "observe",
            _ => return HelperResponse::error(request, "NOT_SUPPORTED", false),
        };
        if !lease.capabilities.contains(capability) {
            return HelperResponse::error(request, "UNAUTHORIZED", false);
        }
        let initial_quota_available = lease.quotas.operations > 0
            && match capability {
                "pointer" => lease.quotas.pointer_actions > 0,
                "keyboard" => {
                    lease.quotas.key_actions > 0
                        && (kind != "type"
                            || lease.quotas.text_bytes
                                >= request.string("text").map_or(0, |text| text.len() as u64))
                }
                "observe" => true,
                _ => false,
            };
        if !initial_quota_available {
            return HelperResponse::error(request, "QUOTA_EXCEEDED", false);
        }
        if self.last_snapshot_revision != 0
            && required_integer(request, "snapshotRevision") != self.last_snapshot_revision
        {
            return HelperResponse::error(request, "STALE_REF", false);
        }
        let clock = &self.clock;
        let mut permit = |cost: NativeInputCost| -> Result<(), &'static str> {
            if cancel.is_cancelled() {
                return Err("CANCELLED");
            }
            let event_now_ms = clock.now_ms();
            if event_now_ms >= deadline_ms {
                return Err("TIMEOUT");
            }
            if lease.expired(event_now_ms) {
                return Err("LEASE_EXPIRED");
            }
            if !lease.capabilities.contains(capability) {
                return Err("UNAUTHORIZED");
            }
            if lease.quotas.operations == 0
                || lease.quotas.pointer_actions < cost.pointer_events
                || lease.quotas.key_actions < cost.key_events
                || lease.quotas.text_bytes < cost.text_bytes
            {
                return Err("QUOTA_EXCEEDED");
            }
            lease.quotas.operations -= 1;
            lease.quotas.pointer_actions -= cost.pointer_events;
            lease.quotas.key_actions -= cost.key_events;
            lease.quotas.text_bytes -= cost.text_bytes;
            lease.last_activity_ms = event_now_ms;
            Ok(())
        };
        let result = self
            .platform
            .input(request, deadline_ms, cancel, &mut permit);
        platform_response(request, result, cancel, None)
    }

    /// Release all helper-owned input state before EOF or fatal link shutdown.
    pub fn shutdown(&mut self) -> Result<(), &'static str> {
        self.active = None;
        let cancel = CancellationToken::new();
        self.platform
            .release_all_input(self.clock.now_ms().saturating_add(1_000), &cancel)
    }

    fn expire_active(&mut self, now_ms: u64) -> Option<ActiveLease> {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.lease.expired(now_ms))
        {
            return self.active.take();
        }
        None
    }

    fn active_lease_for(
        &mut self,
        request: &HelperRequest,
        now_ms: u64,
    ) -> std::result::Result<&mut Lease, &'static str> {
        if let Some(expired) = self.expire_active(now_ms) {
            return Err(if active_matches(&expired, request) {
                "LEASE_EXPIRED"
            } else {
                "LEASE_REVOKED"
            });
        }
        let Some(active) = self.active.as_mut() else {
            return Err("LEASE_REVOKED");
        };
        if !active_matches(active, request) {
            return Err("LEASE_REVOKED");
        }
        Ok(&mut active.lease)
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
                    let active = self.active.take().expect("active lease checked");
                    self.last_revoked = Some(RevokedLeaseIdentity::from_active(&active));
                    let cancel = CancellationToken::new();
                    let _ = self
                        .platform
                        .release_all_input(self.clock.now_ms().saturating_add(1_000), &cancel);
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
                    let active = self.active.take().expect("active lease checked");
                    self.last_revoked = Some(RevokedLeaseIdentity::from_active(&active));
                    let cancel = CancellationToken::new();
                    let _ = self
                        .platform
                        .release_all_input(self.clock.now_ms().saturating_add(1_000), &cancel);
                }
            }
            "parent.shutdown" => {
                self.active = None;
                self.last_revoked = None;
                let cancel = CancellationToken::new();
                let _ = self
                    .platform
                    .release_all_input(self.clock.now_ms().saturating_add(1_000), &cancel);
            }
            "request.cancel" => {}
            _ => {}
        }
    }
}

fn active_matches(active: &ActiveLease, request: &HelperRequest) -> bool {
    active.session_id == request.session_id()
        && active.lease_id == required_string(request, "leaseId")
        && active.lease.revision == required_integer(request, "leaseRevision")
}

fn platform_response(
    request: &HelperRequest,
    result: PlatformResult,
    cancel: &CancellationToken,
    png: Option<Vec<u8>>,
) -> HelperResponse {
    if cancel.is_cancelled() {
        return HelperResponse::error(request, "CANCELLED", false);
    }
    match result {
        Ok(result) => match png {
            Some(png) => HelperResponse::ok_with_png(request, result, png),
            None => HelperResponse::ok(request, result),
        },
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
