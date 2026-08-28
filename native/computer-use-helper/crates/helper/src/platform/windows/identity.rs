//! Stable HWND, PID, and process-creation identity checks.

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HWND};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};
#[cfg(target_os = "windows")]
use windows::core::PWSTR;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowIdentity {
    pub(crate) hwnd: i64,
    pub(crate) pid: u32,
    pub(crate) process_created_at_100ns: u64,
}

impl WindowIdentity {
    pub(crate) fn new(hwnd: i64, pid: u32, process_created_at_100ns: u64) -> Option<Self> {
        if hwnd == 0 || pid == 0 || process_created_at_100ns == 0 {
            return None;
        }
        Some(Self {
            hwnd,
            pid,
            process_created_at_100ns,
        })
    }

    pub(crate) fn matches(self, observed: Self) -> bool {
        self == observed
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn hwnd(self) -> HWND {
        HWND(self.hwnd as isize as *mut core::ffi::c_void)
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn query_window_identity(hwnd: HWND) -> Result<WindowIdentity, &'static str> {
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err("TARGET_CLOSED");
    }
    let mut pid = 0_u32;
    if unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) } == 0 || pid == 0 {
        return Err("TARGET_CLOSED");
    }
    let process = OwnedHandle::open(pid)?;
    let created = process.creation_time()?;
    WindowIdentity::new(hwnd.0 as isize as i64, pid, created).ok_or("TARGET_CLOSED")
}

#[cfg(target_os = "windows")]
pub(crate) fn process_name(pid: u32) -> Result<String, &'static str> {
    let process = OwnedHandle::open(pid)?;
    let mut buffer = vec![0_u16; 32_768];
    let mut length = u32::try_from(buffer.len()).map_err(|_| "INTERNAL")?;
    unsafe {
        QueryFullProcessImageNameW(
            process.0,
            Default::default(),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
        .map_err(|_| "TARGET_CLOSED")?;
    }
    let path =
        String::from_utf16_lossy(&buffer[..usize::try_from(length).map_err(|_| "INTERNAL")?]);
    let name = path.rsplit(['\\', '/']).next().unwrap_or("").trim();
    if name.is_empty() {
        return Err("TARGET_CLOSED");
    }
    Ok(name.to_owned())
}

#[cfg(target_os = "windows")]
pub(crate) struct OwnedHandle(HANDLE);

#[cfg(target_os = "windows")]
impl OwnedHandle {
    pub(crate) fn from_raw(handle: HANDLE) -> Result<Self, &'static str> {
        if handle.is_invalid() {
            return Err("PERMISSION_DENIED");
        }
        Ok(Self(handle))
    }

    pub(crate) fn open(pid: u32) -> Result<Self, &'static str> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|_| "PERMISSION_DENIED")?;
        Self::from_raw(handle)
    }

    pub(crate) fn raw(&self) -> HANDLE {
        self.0
    }

    fn creation_time(&self) -> Result<u64, &'static str> {
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe {
            GetProcessTimes(self.0, &mut creation, &mut exit, &mut kernel, &mut user)
                .map_err(|_| "TARGET_CLOSED")?;
        }
        Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
    }
}

#[cfg(target_os = "windows")]
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::WindowIdentity;

    #[test]
    fn rejects_incomplete_identity_and_matches_all_three_components() {
        assert!(WindowIdentity::new(0, 7, 11).is_none());
        assert!(WindowIdentity::new(5, 0, 11).is_none());
        assert!(WindowIdentity::new(5, 7, 0).is_none());

        let expected = WindowIdentity::new(5, 7, 11).expect("complete identity");
        assert!(expected.matches(expected));
        assert!(!expected.matches(WindowIdentity::new(6, 7, 11).expect("new HWND")));
        assert!(!expected.matches(WindowIdentity::new(5, 8, 11).expect("new PID")));
        assert!(!expected.matches(WindowIdentity::new(5, 7, 12).expect("reused process")));
    }
}
