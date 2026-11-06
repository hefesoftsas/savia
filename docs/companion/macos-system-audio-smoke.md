# macOS system-audio smoke result

Run: 2026-10-01. Scope: one manual system-output capture, not platform qualification.

## Environment and provenance

- macOS 26.2, arm64; built-in `Mac mini Speakers`, default output at 48 kHz.
- Locally built Tauri debug application, version 0.1.0.
- Repository base: `a885eff6ead02b2d395ab011075bb700fca1c72d`, with the Companion implementation still uncommitted. This is not an immutable release revision.
- Executable SHA-256: `e46d3c1f5f5ee39a88ac9eb09b555f0a3a2582e37b76aea43891830af8269791`.
- Fixture: YouTube playback of [NASA historic film Apollo / Saturn “The Giant Step”](https://www.youtube.com/watch?v=Er1j5f6MLpg). The advertisement was skipped before capture. The system-output mix is captured; this does not prove per-application isolation.

## Procedure and observations

1. Open the final local macOS application bundle; confirm idle state.
2. Disable Microphone and retain System audio. Start YouTube playback.
3. Click Start recording in the actual desktop UI. Observe Recording and an increasing timer.
4. Click Stop recording. Observe Audio ready and one system track, displayed as 36.1 seconds / 3389 KiB.
5. Pause YouTube. Copy the host-owned helper's finalized PCM into an ignored local WAV evidence file with a 44-byte PCM16 header. No samples were synthesized, resampled or amplified. The 48 kHz output-device report and WAV duration agree with the native track duration.
6. Run the existing WAV inspector on the evidence copy.

| Metric                  | Result                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Format                  | PCM16, mono, 48,000 Hz                                             |
| Sample frames           | 1,735,168                                                          |
| Duration                | 36.149333 seconds                                                  |
| WAV bytes               | 3,470,380                                                          |
| RMS amplitude           | 0.052444                                                           |
| Peak amplitude          | 0.374084                                                           |
| Exact-zero sample ratio | 0.001302                                                           |
| Clipped sample ratio    | 0                                                                  |
| WAV SHA-256             | `53b857faf75098884db8d93406af9c3d7376c7b084719e6b8e08f69e7c5174a8` |

The ignored WAV evidence copy, all screenshots from this test, and the original native capture directory were deleted at the user's request after inspection. The desktop capture was discarded. Only this metrics report remains; the recorded media is no longer available. No provider call or microphone capture was made.

## Assessment

System-output capture/start/stop and non-silent finalized PCM: **pass for this smoke run**. Listening and matching the captured narration to the source remain pending; amplitude metrics alone do not prove intelligibility. Microphone, simultaneous sources, permission grant/deny/revoke, Bluetooth/USB devices, automatic duration stop, sustained sessions, Windows and live STT/summary were not exercised. G1 remains pending under the full [validation protocol](validation.md).
