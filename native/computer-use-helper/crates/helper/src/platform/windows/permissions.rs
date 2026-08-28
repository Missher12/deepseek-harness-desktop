//! Windows observation and input permission policy.

#[cfg(target_os = "windows")]
use windows::Graphics::Capture::GraphicsCaptureSession;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HANDLE;
#[cfg(target_os = "windows")]
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TOKEN_MANDATORY_LABEL,
    TOKEN_QUERY, TokenIntegrityLevel,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, DESKTOP_READOBJECTS, GetUserObjectInformationW, OpenInputDesktop, UOI_NAME,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::SystemServices::{
    SECURITY_MANDATORY_HIGH_RID, SECURITY_MANDATORY_LOW_RID, SECURITY_MANDATORY_MEDIUM_RID,
    SECURITY_MANDATORY_SYSTEM_RID,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

#[cfg(target_os = "windows")]
use super::identity::OwnedHandle;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum IntegrityLevel {
    Unknown,
    Low,
    Medium,
    High,
    System,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopSecurity {
    Unknown,
    Interactive,
    Secure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PermissionSnapshot {
    pub(crate) uia_available: bool,
    pub(crate) capture_available: bool,
    pub(crate) desktop: DesktopSecurity,
    pub(crate) current_integrity: IntegrityLevel,
    pub(crate) target_integrity: IntegrityLevel,
    pub(crate) password_surface: bool,
}

impl PermissionSnapshot {
    pub(crate) fn authorize_observation(self) -> Result<(), &'static str> {
        if !self.uia_available
            || self.desktop != DesktopSecurity::Interactive
            || self.current_integrity == IntegrityLevel::Unknown
            || self.current_integrity >= IntegrityLevel::High
            || self.target_integrity == IntegrityLevel::Unknown
            || self.target_integrity > self.current_integrity
            || self.target_integrity >= IntegrityLevel::High
            || self.password_surface
        {
            return Err("PERMISSION_DENIED");
        }
        Ok(())
    }

    pub(crate) fn authorize_input(self) -> Result<(), &'static str> {
        self.authorize_observation()?;
        if self.current_integrity == IntegrityLevel::Unknown
            || self.target_integrity == IntegrityLevel::Unknown
            || self.target_integrity > self.current_integrity
        {
            return Err("PERMISSION_DENIED");
        }
        Ok(())
    }

    pub(crate) fn authorize_capture(self) -> Result<(), &'static str> {
        self.authorize_observation()?;
        if !self.capture_available {
            return Err("PERMISSION_DENIED");
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn native_permission_snapshot(
    target_pid: u32,
    password_surface: bool,
) -> PermissionSnapshot {
    PermissionSnapshot {
        uia_available: uia_available(),
        capture_available: GraphicsCaptureSession::IsSupported().unwrap_or(false),
        desktop: input_desktop_security(),
        current_integrity: process_integrity(None),
        target_integrity: process_integrity(Some(target_pid)),
        password_surface,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn platform_available() -> (bool, bool, DesktopSecurity) {
    (
        GraphicsCaptureSession::IsSupported().unwrap_or(false),
        uia_available(),
        input_desktop_security(),
    )
}

#[cfg(target_os = "windows")]
fn uia_available() -> bool {
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
    use windows::Win32::UI::Accessibility::{CUIAutomation8, IUIAutomation};

    unsafe { CoCreateInstance::<_, IUIAutomation>(&CUIAutomation8, None, CLSCTX_INPROC_SERVER) }
        .is_ok()
}

#[cfg(target_os = "windows")]
fn input_desktop_security() -> DesktopSecurity {
    let Ok(desktop) = (unsafe { OpenInputDesktop(Default::default(), false, DESKTOP_READOBJECTS) })
    else {
        return DesktopSecurity::Unknown;
    };
    let result = (|| {
        let handle = HANDLE(desktop.0);
        let mut needed = 0_u32;
        let _ = unsafe { GetUserObjectInformationW(handle, UOI_NAME, None, 0, Some(&mut needed)) };
        if !(2..=1_024).contains(&needed) {
            return DesktopSecurity::Unknown;
        }
        let mut name = vec![0_u16; usize::try_from(needed / 2).unwrap_or(0)];
        if name.is_empty()
            || unsafe {
                GetUserObjectInformationW(
                    handle,
                    UOI_NAME,
                    Some(name.as_mut_ptr().cast()),
                    needed,
                    Some(&mut needed),
                )
            }
            .is_err()
        {
            return DesktopSecurity::Unknown;
        }
        let end = name
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(name.len());
        if String::from_utf16_lossy(&name[..end]).eq_ignore_ascii_case("default") {
            DesktopSecurity::Interactive
        } else {
            DesktopSecurity::Secure
        }
    })();
    let _ = unsafe { CloseDesktop(desktop) };
    result
}

#[cfg(target_os = "windows")]
fn process_integrity(pid: Option<u32>) -> IntegrityLevel {
    let process = match pid {
        Some(pid) => match OwnedHandle::open(pid) {
            Ok(process) => process,
            Err(_) => return IntegrityLevel::Unknown,
        },
        None => return current_process_integrity(),
    };
    integrity_for_process(process.raw())
}

#[cfg(target_os = "windows")]
fn current_process_integrity() -> IntegrityLevel {
    integrity_for_process(unsafe { GetCurrentProcess() })
}

#[cfg(target_os = "windows")]
fn integrity_for_process(process: HANDLE) -> IntegrityLevel {
    let mut token = HANDLE::default();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.is_err() {
        return IntegrityLevel::Unknown;
    }
    let Ok(token) = OwnedHandle::from_raw(token) else {
        return IntegrityLevel::Unknown;
    };
    let mut needed = 0_u32;
    let _ = unsafe { GetTokenInformation(token.raw(), TokenIntegrityLevel, None, 0, &mut needed) };
    let word = core::mem::size_of::<usize>();
    let slots = usize::try_from(needed)
        .ok()
        .and_then(|bytes| bytes.checked_add(word - 1))
        .map(|bytes| bytes / word)
        .unwrap_or(0);
    if slots == 0 || needed > 4_096 {
        return IntegrityLevel::Unknown;
    }
    let mut buffer = vec![0_usize; slots];
    if unsafe {
        GetTokenInformation(
            token.raw(),
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
    }
    .is_err()
    {
        return IntegrityLevel::Unknown;
    }
    let label = unsafe { &*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>() };
    if label.Label.Sid.0.is_null() {
        return IntegrityLevel::Unknown;
    }
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    if count == 0 {
        return IntegrityLevel::Unknown;
    }
    let rid = unsafe { *GetSidSubAuthority(label.Label.Sid, u32::from(count - 1)) };
    match i32::try_from(rid).unwrap_or(i32::MAX) {
        value if value >= SECURITY_MANDATORY_SYSTEM_RID => IntegrityLevel::System,
        value if value >= SECURITY_MANDATORY_HIGH_RID => IntegrityLevel::High,
        value if value >= SECURITY_MANDATORY_MEDIUM_RID => IntegrityLevel::Medium,
        value if value >= SECURITY_MANDATORY_LOW_RID => IntegrityLevel::Low,
        _ => IntegrityLevel::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::{DesktopSecurity, IntegrityLevel, PermissionSnapshot};

    fn ordinary() -> PermissionSnapshot {
        PermissionSnapshot {
            uia_available: true,
            capture_available: true,
            desktop: DesktopSecurity::Interactive,
            current_integrity: IntegrityLevel::Medium,
            target_integrity: IntegrityLevel::Medium,
            password_surface: false,
        }
    }

    #[test]
    fn allows_only_known_interactive_non_sensitive_observation() {
        assert_eq!(ordinary().authorize_observation(), Ok(()));
        for denied in [
            PermissionSnapshot {
                desktop: DesktopSecurity::Secure,
                ..ordinary()
            },
            PermissionSnapshot {
                desktop: DesktopSecurity::Unknown,
                ..ordinary()
            },
            PermissionSnapshot {
                uia_available: false,
                ..ordinary()
            },
            PermissionSnapshot {
                password_surface: true,
                ..ordinary()
            },
        ] {
            assert_eq!(denied.authorize_observation(), Err("PERMISSION_DENIED"));
        }
    }

    #[test]
    fn fails_input_closed_for_uipi_high_integrity_and_unknown_state() {
        assert_eq!(ordinary().authorize_input(), Ok(()));
        assert_eq!(
            PermissionSnapshot {
                target_integrity: IntegrityLevel::Low,
                ..ordinary()
            }
            .authorize_input(),
            Ok(()),
        );
        for denied in [
            PermissionSnapshot {
                target_integrity: IntegrityLevel::High,
                ..ordinary()
            },
            PermissionSnapshot {
                target_integrity: IntegrityLevel::System,
                ..ordinary()
            },
            PermissionSnapshot {
                target_integrity: IntegrityLevel::Unknown,
                ..ordinary()
            },
            PermissionSnapshot {
                current_integrity: IntegrityLevel::Unknown,
                ..ordinary()
            },
            PermissionSnapshot {
                current_integrity: IntegrityLevel::High,
                ..ordinary()
            },
            PermissionSnapshot {
                current_integrity: IntegrityLevel::System,
                ..ordinary()
            },
            PermissionSnapshot {
                desktop: DesktopSecurity::Secure,
                ..ordinary()
            },
            PermissionSnapshot {
                password_surface: true,
                ..ordinary()
            },
        ] {
            assert_eq!(denied.authorize_input(), Err("PERMISSION_DENIED"));
        }
    }
}
