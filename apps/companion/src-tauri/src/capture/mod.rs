pub mod audio;
pub mod codec;
pub mod lifecycle;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub(crate) type SystemCapture = macos::SystemCapture;
#[cfg(target_os = "windows")]
pub(crate) type SystemCapture = windows::SystemCapture;

#[cfg(target_os = "macos")]
pub fn authorize_microphone(temp_dir: &std::path::Path) -> Result<(), String> {
    macos::SystemCapture::authorize_microphone(temp_dir)
}

#[cfg(target_os = "windows")]
pub fn authorize_microphone(_temp_dir: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
compile_error!("Savia Companion native capture currently supports macOS and Windows only");
