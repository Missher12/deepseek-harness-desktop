#![cfg(target_os = "macos")]

use computer_use_helper::platform::macos::{
    MacProcessIdentity, encode_app_id, encode_window_id, permission_status,
};

#[test]
fn exact_app_process_and_window_identity_rejects_reuse() {
    let first = MacProcessIdentity {
        pid: 123,
        start_seconds: 1_000,
        start_microseconds: 55,
        bundle_id: "com.example.TextEdit".into(),
    };
    let reused = MacProcessIdentity {
        start_microseconds: 56,
        ..first.clone()
    };

    assert_ne!(encode_app_id(&first), encode_app_id(&reused));
    assert_ne!(encode_window_id(&first, 42), encode_window_id(&reused, 42));
    assert_ne!(encode_window_id(&first, 42), encode_window_id(&first, 43));
}

#[test]
fn permission_status_is_a_prompt_free_closed_mapping() {
    assert_eq!(
        permission_status(true, true, true),
        serde_json::json!({
            "viewing": "granted", "assistive": "granted", "supported": true
        })
    );
    assert_eq!(
        permission_status(true, false, true),
        serde_json::json!({
            "viewing": "denied", "assistive": "granted", "supported": true
        })
    );
    assert_eq!(
        permission_status(false, true, true),
        serde_json::json!({
            "viewing": "unknown", "assistive": "unknown", "supported": false
        })
    );
}
