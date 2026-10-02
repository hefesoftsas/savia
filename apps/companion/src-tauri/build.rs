fn main() {
    #[cfg(target_os = "macos")]
    compile_macos_capture_helper();
    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn compile_macos_capture_helper() {
    use std::{env, path::PathBuf, process::Command};

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let source = manifest.join("macos/capture.swift");
    let info_plist = manifest.join("macos/helper-Info.plist");
    let output =
        PathBuf::from(env::var("OUT_DIR").expect("cargo output dir")).join("savia-capture-macos");
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed={}", info_plist.display());

    if !source.exists() {
        return;
    }

    let result = Command::new("xcrun")
        .args([
            "swiftc",
            "-O",
            "-framework",
            "CoreAudio",
            "-framework",
            "AVFoundation",
        ])
        .args([
            "-Xlinker",
            "-sectcreate",
            "-Xlinker",
            "__TEXT",
            "-Xlinker",
            "__info_plist",
            "-Xlinker",
        ])
        .arg(&info_plist)
        .arg("-o")
        .arg(&output)
        .arg(&source)
        .status()
        .expect("xcrun swiftc is required to build the macOS capture adapter");
    assert!(
        result.success(),
        "failed to compile the Core Audio capture helper"
    );
    println!("cargo:rustc-env=SAVIA_CAPTURE_HELPER={}", output.display());
}
