//! Per-monitor DPI and signed virtual-desktop coordinate conversion.

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::HiDpi::{
    AreDpiAwarenessContextsEqual, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow,
    GetThreadDpiAwarenessContext, SetProcessDpiAwarenessContext,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PhysicalPoint {
    pub(crate) x: i32,
    pub(crate) y: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PhysicalRect {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) right: i32,
    pub(crate) bottom: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct VirtualDesktop {
    pub(crate) bounds: PhysicalRect,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Dpi {
    pub(crate) x: u32,
    pub(crate) y: u32,
}

impl VirtualDesktop {
    pub(crate) fn normalize_for_send_input(self, point: PhysicalPoint) -> Option<(u16, u16)> {
        let width = i64::from(self.bounds.right) - i64::from(self.bounds.left);
        let height = i64::from(self.bounds.bottom) - i64::from(self.bounds.top);
        if width < 2
            || height < 2
            || point.x < self.bounds.left
            || point.x >= self.bounds.right
            || point.y < self.bounds.top
            || point.y >= self.bounds.bottom
        {
            return None;
        }
        let x =
            (i64::from(point.x) - i64::from(self.bounds.left)) * i64::from(u16::MAX) / (width - 1);
        let y =
            (i64::from(point.y) - i64::from(self.bounds.top)) * i64::from(u16::MAX) / (height - 1);
        Some((u16::try_from(x).ok()?, u16::try_from(y).ok()?))
    }
}

impl Dpi {
    #[cfg(test)]
    pub(crate) fn logical_to_physical(self, point: PhysicalPoint) -> Option<PhysicalPoint> {
        if self.x == 0 || self.y == 0 {
            return None;
        }
        Some(PhysicalPoint {
            x: scale_axis(point.x, self.x)?,
            y: scale_axis(point.y, self.y)?,
        })
    }
}

#[cfg(test)]
fn scale_axis(value: i32, dpi: u32) -> Option<i32> {
    let numerator = i64::from(value).checked_mul(i64::from(dpi))?;
    let rounded = if numerator >= 0 {
        numerator.checked_add(48)?
    } else {
        numerator.checked_sub(48)?
    };
    i32::try_from(rounded / 96).ok()
}

#[cfg(target_os = "windows")]
pub(crate) fn enable_per_monitor_v2() -> bool {
    if unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }.is_ok()
    {
        return true;
    }
    unsafe {
        AreDpiAwarenessContextsEqual(
            GetThreadDpiAwarenessContext(),
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        )
        .as_bool()
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn dpi_for_window(hwnd: HWND) -> Result<Dpi, &'static str> {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        return Err("TARGET_CLOSED");
    }
    Ok(Dpi { x: dpi, y: dpi })
}

#[cfg(target_os = "windows")]
pub(crate) fn virtual_desktop() -> Result<VirtualDesktop, &'static str> {
    let left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if width < 2 || height < 2 {
        return Err("NOT_SUPPORTED");
    }
    Ok(VirtualDesktop {
        bounds: PhysicalRect {
            left,
            top,
            right: left.checked_add(width).ok_or("INTERNAL")?,
            bottom: top.checked_add(height).ok_or("INTERNAL")?,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{Dpi, PhysicalPoint, PhysicalRect, VirtualDesktop};

    #[test]
    fn normalizes_signed_virtual_desktop_coordinates_without_clamping() {
        let desktop = VirtualDesktop {
            bounds: PhysicalRect {
                left: -1920,
                top: -1080,
                right: 1920,
                bottom: 1080,
            },
        };
        assert_eq!(
            desktop.normalize_for_send_input(PhysicalPoint { x: -1920, y: -1080 }),
            Some((0, 0)),
        );
        assert_eq!(
            desktop.normalize_for_send_input(PhysicalPoint { x: 1919, y: 1079 }),
            Some((u16::MAX, u16::MAX)),
        );
        assert_eq!(
            desktop.normalize_for_send_input(PhysicalPoint { x: -1921, y: 0 }),
            None,
        );
    }

    #[test]
    fn converts_per_monitor_logical_points_with_signed_rounding() {
        let dpi = Dpi { x: 144, y: 120 };
        assert_eq!(
            dpi.logical_to_physical(PhysicalPoint { x: -101, y: 48 }),
            Some(PhysicalPoint { x: -152, y: 60 }),
        );
        assert_eq!(
            Dpi { x: 0, y: 96 }.logical_to_physical(PhysicalPoint { x: 1, y: 1 }),
            None,
        );
    }
}
