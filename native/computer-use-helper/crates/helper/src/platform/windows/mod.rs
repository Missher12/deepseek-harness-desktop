//! Windows Computer Use platform adapter.

mod capture;
mod composition;
mod identity;
mod input;
mod permissions;
mod scale;
mod uia;

#[cfg(target_os = "windows")]
/// Construct the Windows adapter without performing native work.
#[must_use]
pub fn observation_platform(
    epoch: std::time::Instant,
) -> impl computer_use_core::ObservationPlatform {
    composition::WindowsObservationPlatform::new(epoch)
}
