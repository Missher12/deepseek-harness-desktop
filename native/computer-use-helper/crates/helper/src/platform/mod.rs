//! Platform backend selection without widening the protocol surface.

#[cfg(target_os = "macos")]
pub mod macos;
