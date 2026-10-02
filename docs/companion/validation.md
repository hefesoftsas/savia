# Companion validation protocol

Owner: Savia platform maintainers. Reviewed: 2026-10-01.
Status: test protocol; one [macOS system-output smoke run](macos-system-audio-smoke.md) recorded. Full native and live-provider qualification remains pending.

## Evidence rules

Use synthetic speech/tone fixtures or recordings whose participants have explicitly
allowed this evaluation. Keep raw media, transcripts and provider responses in
restricted storage outside Git. Commit only sanitized aggregate reports and
fixture-generation code. Every result needs an immutable code revision, exact
OS/build, hardware/device identity and a reproducible procedure. Mark each run
`not-run`, `pass`, `fail` or `blocked`; an untested cell never counts as supported.

A passing unit test with generated WAV data only verifies the inspector. It does
not prove actual recording, permission behavior or transcription accuracy. Real
OS capture gates require native binaries and listening to produced files.

## Platform and device coverage

| Target                   | Minimum initial test cases                                                                                                         | Current status                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| macOS                    | Apple Silicon on oldest selected 14.2+ build and current supported release; built-in mic/output, USB headset and Bluetooth headset | Not run.                                       |
| Windows                  | Windows 11 x64 on oldest selected and current supported build; built-in audio, USB headset and Bluetooth headset                   | Not run.                                       |
| Additional architectures | Intel Mac, Windows ARM and Windows 10 build-specific tests                                                                         | Deferred; no support claim.                    |
| Meeting applications     | Teams, Zoom and Meet, with exact native/browser app versions recorded                                                              | Not run; test with allowed synthetic meetings. |

Test user permission grant, deny, revoke and re-grant. On macOS repeat with a signed
application on a fresh user profile. On Windows test microphone privacy settings,
endpoint changes and unavailable/exclusive devices. Confirm capture stops after
stop, discard, crash and logout according to the accepted session policy.

## Short capture experiment

1. Record environment, selected source devices, code revision and permission state.
2. Start recording manually. Confirm source labels, indicator and live levels.
3. Feed distinct synthetic spoken phrases into the microphone and selected output,
   including a synchronization marker. Never use a generated PCM fixture alone as
   evidence that the OS supplied audio.
4. Record mic-only, output-only, both, and all-sources-disabled runs. For combined
   capture retain separate source files and a shared manifest.
5. Stop and verify files are finalized and independently decodable. Listen to both
   sources. Confirm expected phrases and markers, and record acoustic bleed.
6. Inspect a short finalized PCM16 WAV copy using:

   ```sh
   pnpm --filter @savia/companion audio:inspect /absolute/path/to/sample.wav
   ```

7. Record metrics and listening findings; reject silent or missing-source output.
   RMS/zero ratios are diagnostics, not universal speech quality thresholds.
8. Repeat deny/revoke and device-disconnect cases; verify truthful failure messages
   instead of an apparently successful recording containing silence.

## Sustained and failure experiments

Run 5-minute smoke tests, 30-minute baseline tests and 2-hour qualification tests.
These durations are proposed validation coverage, not product duration limits.
Before each qualification series, agree allowable source skew, drift, gap length,
CPU/memory, disk growth and clipping with the product/audio owners. Record numeric
thresholds and measured values in the report; do not retroactively move a threshold
to turn a failed run into a pass.

| Failure or transition                          | Required evidence                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bluetooth connect/disconnect or profile switch | Actual routes before/after, detected gap, sample rate change and UI outcome.          |
| USB unplug/replug / default output change      | No unintended source switch; gap/recovery timeline is explicit.                       |
| Sleep/wake / wall clock adjustment             | Monotonic offsets remain ordered; discontinuity is visible.                           |
| Crash / force quit during write                | Finalized prior chunks recover; incomplete tail is identified, not uploaded as valid. |
| Disk quota/full / permission denied            | Capture/backpressure policy is visible and media stays bounded.                       |
| Network outage / reconnect / revoked token     | No loss of retained accepted chunks; only missing authorized chunks resume.           |
| Duplicate upload / delayed acknowledgement     | Same logical chunk produces one persisted transcript result.                          |
| Provider accepted then timed out               | Ambiguous billed attempt is reconciled; no blind unlimited retry.                     |
| Stop/cancel/discard/delete                     | Native handles close; queued work and retention follow the defined state transitions. |
| Two tenants requesting the same object/job     | All unauthorized access is denied, including temporary URLs and retries.              |

Inspect every upload chunk with an independent decoder, including chunks whose
boundaries split speech. Arbitrary byte slicing and unfinalized recorder fragments
are invalid. Measure missing/duplicated words and distinguish local capture gaps
from STT failures. Provider speaker indexes may reset per chunk; do not merge them
into global identities without a tested reconciliation method.

## Provider benchmark

Only run paid requests after an authorized test account, bounded spending ceiling
and permitted fixture set are configured. This change makes no provider calls.
Run the same independently decodable samples against each candidate STT model:
Spanish single speaker, Spanish multi-speaker, accents, domain vocabulary,
crosstalk, background noise, silence and bilingual segments.

Capture model ID, actual provider if available, request format, audio seconds,
payload bytes, submit/finish times, returned capabilities, usage/cost, failures and
retry decisions. Score against a human-checked reference using word error rate,
missing/duplicated boundary words and timestamp alignment; diarization needs its
own labeled reference and scoring. Missing provider usage must be represented as
unknown, not zero. Separate upload latency, queue wait, STT latency and summary
latency. Do not embed current prices as permanent expectations.

Confirm privacy/retention policy for the actual STT route and selected model.
Prove supported routing controls rather than inheriting assumptions from chat.
If mandatory policy cannot be enforced, the model fails eligibility even if its
transcript quality is high. Validate timeout, rate limiting, malformed responses,
partial completion and cancellation in contract tests before a live benchmark.

## Result template

```text
Run ID / date / operator:
Epic and story:
Commit / native build identity / signing state:
OS version and build / CPU architecture:
Devices / drivers / firmware / selected input and output:
Meeting app and version:
Permissions and privacy settings:
Fixture identity / permitted-use record / reference transcript:
Capture duration / source tracks / container and codec:
Provider / model / provider-policy evidence date:
Pre-agreed thresholds:
Expected behavior:
Observed behavior and metric values:
Restricted evidence location / sanitized report link:
Cost (known, estimated or unknown) / billed attempts:
Result (not-run, pass, fail, blocked):
Failure classification / reproduction / next owner:
Reviewer and gate decision:
```

## First go/no-go

Pass G1 separately for each initial OS only when microphone and output are audible,
permissions are truthful, files decode, start/stop releases resources and route
changes are represented honestly. If a platform fails, retain its evidence and
change the adapter or support scope before expanding UI/backend work. Pass G2 only
when actual authorized upload/STT runs, tenant isolation, limits and policy checks
succeed. Later pilot gates add recovery, long sessions, summary evaluation and
signed installer qualification; a demo recording alone does not pass them.
