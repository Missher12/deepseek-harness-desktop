//! Fixed screenshot scaling policy shared by all SCK capture attempts.

use computer_use_core::{ObservationBounds, capture_dimensions};

/// The capture makes at most three progressively smaller attempts.
pub const MAX_DOWNSCALE_ATTEMPTS: usize = 3;

/// Calculate one deterministic capture attempt within the fixed edge/pixel limits.
#[must_use]
pub fn attempt_dimensions(
    bounds: ObservationBounds,
    point_pixel_scale: f64,
    attempt: usize,
) -> Option<(u32, u32)> {
    if attempt >= MAX_DOWNSCALE_ATTEMPTS {
        return None;
    }
    let (width, height) = capture_dimensions(bounds, point_pixel_scale)?;
    let divisor = 1_u32.checked_shl(attempt as u32)?;
    Some(((width / divisor).max(1), (height / divisor).max(1)))
}

#[cfg(test)]
mod tests {
    use computer_use_core::ObservationBounds;

    use super::{MAX_DOWNSCALE_ATTEMPTS, attempt_dimensions};

    #[test]
    fn uses_exactly_three_progressive_bounded_attempts() {
        let bounds = ObservationBounds {
            x: 0.0,
            y: 0.0,
            width: 1_024.0,
            height: 768.0,
        };
        assert_eq!(attempt_dimensions(bounds, 2.0, 0), Some((2_048, 1_536)));
        assert_eq!(attempt_dimensions(bounds, 2.0, 1), Some((1_024, 768)));
        assert_eq!(attempt_dimensions(bounds, 2.0, 2), Some((512, 384)));
        assert_eq!(MAX_DOWNSCALE_ATTEMPTS, 3);
        assert_eq!(attempt_dimensions(bounds, 2.0, 3), None);
    }
}
