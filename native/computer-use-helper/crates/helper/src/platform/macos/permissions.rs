//! Prompt-free macOS permission preflight and pure status mapping.

use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};
use serde_json::{Value, json};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Runtime support is restricted to macOS 14 and newer.
#[must_use]
pub fn supported() -> bool {
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 14,
        minorVersion: 0,
        patchVersion: 0,
    })
}

/// Read current TCC state without requesting access or displaying a prompt.
#[must_use]
pub fn preflight() -> (bool, bool, bool) {
    let is_supported = supported();
    if !is_supported {
        return (false, false, false);
    }
    // SAFETY: This function is a side-effect-free TCC status query.
    let viewing = unsafe { CGPreflightScreenCaptureAccess() };
    // SAFETY: This is the prompt-free accessibility status API.
    let assistive = unsafe { AXIsProcessTrusted() };
    (is_supported, viewing, assistive)
}

/// Pure, testable fail-closed mapping from preflight bits to protocol status.
#[must_use]
pub fn permission_status(is_supported: bool, viewing: bool, assistive: bool) -> Value {
    if !is_supported {
        return json!({"viewing":"unknown","assistive":"unknown","supported":false});
    }
    json!({
        "viewing": if viewing { "granted" } else { "denied" },
        "assistive": if assistive { "granted" } else { "denied" },
        "supported": true,
    })
}
