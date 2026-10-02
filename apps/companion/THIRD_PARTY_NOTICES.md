# Third-party notices

Savia Companion uses the Rust crates below. Versions are pinned in
[`src-tauri/Cargo.lock`](src-tauri/Cargo.lock); license identifiers and source
repositories were checked against the matching published crate manifests.
The links point to the upstream project or its license file. No third-party
source files are copied into this repository.

| Crate         | Version | License           | Upstream                                                     |
| ------------- | ------: | ----------------- | ------------------------------------------------------------ |
| `base64`      |  0.22.1 | MIT OR Apache-2.0 | [rust-base64](https://github.com/marshallpierce/rust-base64) |
| `cpal`        |  0.16.0 | Apache-2.0        | [cpal](https://github.com/RustAudio/cpal)                    |
| `reqwest`     | 0.12.28 | MIT OR Apache-2.0 | [reqwest](https://github.com/seanmonstar/reqwest)            |
| `ruopus`      |   0.1.2 | MIT               | [ruopus](https://github.com/jmg049/ruopus)                   |
| `rubato`      |   5.0.1 | MIT OR Apache-2.0 | [rubato](https://github.com/HEnquist/rubato)                 |
| `serde`       | 1.0.229 | MIT OR Apache-2.0 | [serde](https://github.com/serde-rs/serde)                   |
| `serde_json`  | 1.0.151 | MIT OR Apache-2.0 | [serde_json](https://github.com/serde-rs/json)               |
| `tauri`       |  2.12.1 | Apache-2.0 OR MIT | [Tauri](https://github.com/tauri-apps/tauri)                 |
| `tauri-build` |   2.7.1 | Apache-2.0 OR MIT | [Tauri](https://github.com/tauri-apps/tauri)                 |
| `tempfile`    |  3.27.0 | MIT OR Apache-2.0 | [tempfile](https://github.com/Stebalien/tempfile)            |
| `url`         |   2.5.8 | MIT OR Apache-2.0 | [url](https://github.com/servo/rust-url)                     |
| `wasapi`      |  0.24.0 | MIT               | [wasapi-rs](https://github.com/HEnquist/wasapi-rs)           |

The macOS capture helper uses the system-provided AVFoundation and Core Audio
frameworks; it does not bundle those frameworks. `cpal`'s macOS backend also
uses the upstream [`coreaudio-rs`](https://github.com/RustAudio/coreaudio-rs)
crate (MIT OR Apache-2.0). The Windows system-audio backend uses the pinned
`wasapi` crate above.

Transitive Rust dependencies are pinned by `Cargo.lock` and distributed under
the license expressions declared by their respective upstream crate manifests.
Their sources and license files are available from the registry package URLs
recorded in the lockfile. In particular, the Tauri/WebView dependency graph
includes dependencies under MPL-2.0, Unicode-3.0, ISC, Zlib, and CDLA-Permissive-2.0
in addition to MIT and Apache-2.0; each remains under its upstream license.
