use std::cell::Cell;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;

use computer_use_core::{
    CancellationToken, ComputerUseCore, MonotonicClock, NullObservationPlatform,
    ObservationPlatform, PlatformResult,
};
use computer_use_protocol::{HelperRequest, decode_helper_input};
use serde_json::{Value, json};

const REQUEST_ID: &str = "00000000-0000-4000-8000-000000000001";
const LEASE_ID: &str = "00000000-0000-4000-8000-000000000002";
const OTHER_LEASE_ID: &str = "00000000-0000-4000-8000-000000000003";

#[derive(Clone)]
struct FakeClock(Rc<Cell<u64>>);

impl MonotonicClock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
}

fn request(kind: &str, fields: Value) -> Value {
    request_for_session("session-1", kind, fields)
}

fn request_for_session(session_id: &str, kind: &str, fields: Value) -> Value {
    let mut value = json!({
        "protocolVersion": 1,
        "messageKind": "request",
        "requestKind": kind,
        "requestId": REQUEST_ID,
        "sessionId": session_id,
        "timeoutMs": 1000
    });
    value
        .as_object_mut()
        .expect("object")
        .extend(fields.as_object().expect("fields").clone());
    value
}

fn install(session_id: &str, lease_id: &str, revision: u64) -> Value {
    request_for_session(
        session_id,
        "lease.install",
        json!({
            "leaseId": lease_id,
            "leaseRevision": revision,
            "agentId": "agent-1",
            "targets": [{"appId":"app","windowIds":["window"]}],
            "capabilities": ["observe"],
            "quotas": {"operations":3,"snapshots":2,"pointerActions":0,"keyActions":0,"textBytes":0},
            "idleExpiresAfterMs": 50,
            "hardExpiresAfterMs": 200
        }),
    )
}

fn code(response: &Value) -> Option<&str> {
    response.pointer("/error/code").and_then(Value::as_str)
}

#[test]
fn null_platform_reports_honest_status_and_never_exposes_input_injection() {
    let clock = FakeClock(Rc::new(Cell::new(100)));
    let mut core = ComputerUseCore::new(clock, NullObservationPlatform);

    let status = core
        .handle(decode_helper_input(request("status", json!({}))).expect("status"))
        .expect("response")
        .into_value();
    assert_eq!(
        status.pointer("/result/supported"),
        Some(&Value::Bool(false))
    );

    let list = core
        .handle(decode_helper_input(request("list", json!({}))).expect("list"))
        .expect("response")
        .into_value();
    assert_eq!(list.pointer("/result/apps"), Some(&json!([])));

    let typed = core
        .handle(
            decode_helper_input(request(
                "type",
                json!({
                    "leaseId": LEASE_ID,
                    "leaseRevision": 1,
                    "appId": "app",
                    "windowId": "window",
                    "snapshotRevision": 1,
                    "ref": "computer:00000000000000000000000000000001",
                    "text": "must never be injected"
                }),
            ))
            .expect("type request"),
        )
        .expect("response")
        .into_value();
    assert_eq!(code(&typed), Some("NOT_SUPPORTED"));
}

#[test]
fn installs_exact_monotonic_lease_and_expires_at_the_boundary() {
    let now = Rc::new(Cell::new(1_000));
    let mut core = ComputerUseCore::new(FakeClock(now.clone()), NullObservationPlatform);
    let install = request(
        "lease.install",
        json!({
            "leaseId": LEASE_ID,
            "leaseRevision": 7,
            "agentId": "agent-1",
            "targets": [{"appId":"app","windowIds":["window"]}],
            "capabilities": ["observe"],
            "quotas": {"operations":3,"snapshots":2,"pointerActions":0,"keyActions":0,"textBytes":0},
            "idleExpiresAfterMs": 50,
            "hardExpiresAfterMs": 200
        }),
    );
    let installed = core
        .handle(decode_helper_input(install).expect("install"))
        .expect("response")
        .into_value();
    assert_eq!(installed.pointer("/result/leaseRevision"), Some(&json!(7)));

    now.set(1_050);
    let snapshot = request(
        "snapshot",
        json!({
            "leaseId": LEASE_ID,
            "leaseRevision": 7,
            "appId": "app",
            "windowId": "window",
            "snapshotRevision": 1,
            "includeImage": false
        }),
    );
    let expired = core
        .handle(decode_helper_input(snapshot).expect("snapshot"))
        .expect("response")
        .into_value();
    assert_eq!(code(&expired), Some("LEASE_EXPIRED"));
}

#[test]
fn rejects_non_increasing_revisions_and_exact_revocation_is_idempotent() {
    let clock = FakeClock(Rc::new(Cell::new(10)));
    let mut core = ComputerUseCore::new(clock, NullObservationPlatform);
    let install = |revision| {
        request(
            "lease.install",
            json!({
                "leaseId": LEASE_ID,
                "leaseRevision": revision,
                "agentId": "agent-1",
                "targets": [{"appId":"app","windowIds":["window"]}],
                "capabilities": ["observe"],
                "quotas": {"operations":3,"snapshots":2,"pointerActions":0,"keyActions":0,"textBytes":0},
                "idleExpiresAfterMs": 50,
                "hardExpiresAfterMs": 200
            }),
        )
    };
    assert!(
        core.handle(decode_helper_input(install(2)).expect("install"))
            .is_some()
    );
    let stale = core
        .handle(decode_helper_input(install(2)).expect("stale install"))
        .expect("response")
        .into_value();
    assert_eq!(code(&stale), Some("LEASE_REVOKED"));

    let revoke = json!({
        "protocolVersion": 1,
        "messageKind": "control",
        "controlKind": "lease.revoke",
        "sessionId": "session-1",
        "leaseId": LEASE_ID,
        "leaseRevision": 2
    });
    assert!(
        core.handle(decode_helper_input(revoke.clone()).expect("revoke"))
            .is_none()
    );
    assert!(
        core.handle(decode_helper_input(revoke).expect("repeat revoke"))
            .is_none()
    );
    assert_eq!(core.active_lease_count(), 0);
}

#[test]
fn permits_only_one_process_wide_lease_and_one_global_revision_sequence() {
    let clock = FakeClock(Rc::new(Cell::new(10)));
    let mut core = ComputerUseCore::new(clock, NullObservationPlatform);

    let first = core
        .handle(decode_helper_input(install("session-1", LEASE_ID, 7)).expect("first install"))
        .expect("first response")
        .into_value();
    assert_eq!(first.pointer("/result/leaseRevision"), Some(&json!(7)));
    assert_eq!(core.active_lease_count(), 1);

    let concurrent = core
        .handle(
            decode_helper_input(install("session-2", OTHER_LEASE_ID, 8))
                .expect("concurrent install"),
        )
        .expect("concurrent response")
        .into_value();
    assert_eq!(code(&concurrent), Some("BUSY"));
    assert_eq!(core.active_lease_count(), 1);

    let revoke = json!({
        "protocolVersion": 1,
        "messageKind": "control",
        "controlKind": "lease.revoke",
        "sessionId": "session-1",
        "leaseId": LEASE_ID,
        "leaseRevision": 7
    });
    assert!(
        core.handle(decode_helper_input(revoke).expect("revoke"))
            .is_none()
    );
    assert_eq!(core.active_lease_count(), 0);

    let lower_different_id = core
        .handle(
            decode_helper_input(install("session-2", OTHER_LEASE_ID, 6))
                .expect("lower global revision"),
        )
        .expect("lower response")
        .into_value();
    assert_eq!(code(&lower_different_id), Some("LEASE_REVOKED"));

    let replacement = core
        .handle(
            decode_helper_input(install("session-2", OTHER_LEASE_ID, 8))
                .expect("replacement install"),
        )
        .expect("replacement response")
        .into_value();
    assert_eq!(
        replacement.pointer("/result/leaseRevision"),
        Some(&json!(8))
    );
    assert_eq!(core.active_lease_count(), 1);
}

#[derive(Clone)]
struct AtomicClock(Arc<AtomicU64>);

impl MonotonicClock for AtomicClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct BlockingPlatform {
    entered: mpsc::Sender<()>,
    observed_cancel: mpsc::Sender<()>,
}

impl ObservationPlatform for BlockingPlatform {
    fn status(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
        unreachable!("status is not used")
    }

    fn list(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
        unreachable!("list is not used")
    }

    fn snapshot(
        &mut self,
        _request: &HelperRequest,
        _deadline_ms: u64,
        cancel: &CancellationToken,
    ) -> PlatformResult {
        self.entered.send(()).expect("announce blocked snapshot");
        while !cancel.is_cancelled() {
            thread::yield_now();
        }
        self.observed_cancel
            .send(())
            .expect("announce cancellation");
        Ok(json!({"revision":1,"elements":[]}))
    }
}

#[test]
fn platform_observes_cancellation_and_late_snapshot_result_is_rejected() {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (cancel_tx, cancel_rx) = mpsc::channel();
    let platform = BlockingPlatform {
        entered: entered_tx,
        observed_cancel: cancel_tx,
    };
    let mut core = ComputerUseCore::new(AtomicClock(Arc::new(AtomicU64::new(10))), platform);
    let installed = core
        .handle(decode_helper_input(install("session-1", LEASE_ID, 1)).expect("install"))
        .expect("install response")
        .into_value();
    assert_eq!(installed.pointer("/result/installed"), Some(&json!(true)));

    let snapshot = decode_helper_input(request(
        "snapshot",
        json!({
            "leaseId": LEASE_ID,
            "leaseRevision": 1,
            "appId": "app",
            "windowId": "window",
            "snapshotRevision": 1,
            "includeImage": false
        }),
    ))
    .expect("snapshot");
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let worker = thread::spawn(move || {
        core.handle_with_cancellation(snapshot, &worker_cancel)
            .expect("response")
            .into_value()
    });

    entered_rx.recv().expect("platform entered");
    cancel.cancel();
    cancel_rx.recv().expect("platform observed cancellation");
    let response = worker.join().expect("worker joined");
    assert_eq!(code(&response), Some("CANCELLED"));
}
