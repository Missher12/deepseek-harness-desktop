use std::cell::Cell;
use std::rc::Rc;

use computer_use_core::{ComputerUseCore, MonotonicClock, NullObservationPlatform};
use computer_use_protocol::decode_helper_input;
use serde_json::{Value, json};

const REQUEST_ID: &str = "00000000-0000-4000-8000-000000000001";
const LEASE_ID: &str = "00000000-0000-4000-8000-000000000002";

#[derive(Clone)]
struct FakeClock(Rc<Cell<u64>>);

impl MonotonicClock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
}

fn request(kind: &str, fields: Value) -> Value {
    let mut value = json!({
        "protocolVersion": 1,
        "messageKind": "request",
        "requestKind": kind,
        "requestId": REQUEST_ID,
        "sessionId": "session-1",
        "timeoutMs": 1000
    });
    value
        .as_object_mut()
        .expect("object")
        .extend(fields.as_object().expect("fields").clone());
    value
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
