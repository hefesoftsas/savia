# Savia Companion

Owner: Savia platform maintainers. Reviewed: 2026-10-01.
Status: bounded desktop/API validation implementation; hardware and live-provider gates pending.

Savia Companion is a proposed optional desktop application for manually recording
meetings, uploading audio to Savia, transcribing it, and producing reviewable
minutes with a language model. It is a platform capability; it assumes no
particular industry or meeting provider. The conversation's “Xabia Company” is
interpreted as Savia Companion for this scaffold; confirm the product name before
publishing installers or registering application identifiers.

## What exists today

`apps/companion` now includes a Tauri desktop host, capture controls and bounded
source processing through Savia. Active tenant members and platform administrators
can use their own recordings. Provider requests are opt-in and keep credentials on
the backend. Stopped tracks use mono Opus at a target
32 kbps. Explicit Upload stores private samples in R2; unsaved capture is temporary.
The desktop is a compact capture window. The main Savia app has a Recordings
page with authenticated playback/download and consented transcript/summary
generation. Notes persist on the backend and can be reviewed after reloading.
The WAV inspection CLI remains available for diagnostics.
See the [implementation status](implementation-status.md) for completed code versus
unpassed hardware/provider gates and the remaining epic scope.

| Document                                                                              | Purpose                                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Workspace instructions](../../apps/companion/README.md)                              | Run the available CLI and tests; understand current limits.                       |
| [Meeting model configuration](model-configuration.md)                                 | Configure independent OpenRouter transcription and summary models.                |
| [Live-flow smoke test](live-flow-smoke.md)                                            | Real storage, playback, OpenRouter notes and the remaining macOS capture failure. |
| [Implementation status](implementation-status.md)                                     | Implemented prototype scope and remaining epic gates.                             |
| [Architecture and research](architecture.md)                                          | Deployment decision, component boundaries, reusable OSS and source links.         |
| [Detailed epics](epics.md)                                                            | Dependencies, stories, acceptance criteria, risks and completion gates.           |
| [Validation protocol](validation.md)                                                  | Real-device coverage, controlled audio tests and evidence templates.              |
| [First implementation plan](../superpowers/plans/2026-10-01-companion-feasibility.md) | Ordered next steps and review constraints for the capture proof.                  |

## Delivery strategy

Start with local native capture and Savia-managed remote transcription. Validate
Mac and Windows independently before building the complete meeting product. Use
OpenRouter for STT only after testing its current model capabilities and provider
privacy behavior; use a separate text model for meeting summaries. Do not deploy
an additional VPS transcription stack during the initial proof.

A service cannot capture a laptop's audio without a local recorder or a meeting
bot. Hosting a recorder's server component on a VPS would not remove native OS
capture work. Self-hosted STT remains a later option when measurements show that
privacy, cost, throughput or offline requirements justify operating it.

## Milestones and status

| Gate                    | Outcome                                                    | Current evidence                                                 |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| G0: foundation          | Workspace, executable sample inspector, traceable plan     | Present; automated checks recorded in the change report.         |
| G1: native feasibility  | Audible mic and system samples on each initial OS          | Pending real-device tests.                                       |
| G2: service feasibility | Authorized upload and measured STT end-to-end              | One live synthetic sample passed; broader qualification pending. |
| G3: internal pilot      | Reviewed minutes, recoverable sessions, tenancy and quotas | Pending.                                                         |
| G4: distributable pilot | Signed packages, install/update/recovery test cases        | Pending.                                                         |
| G5: general release     | Sustained pilot metrics and operational ownership          | Pending.                                                         |

Do not set a delivery date from this document. After G1 and G2, estimate remaining
stories using measured effort and unresolved risks. Reliability, OS permissions,
Bluetooth switching, drift and signing are likely to dominate the schedule.
Track actual results in restricted evidence storage, and link sanitized reports
from the backlog. Never commit meeting audio, credentials or confidential transcripts.

## Foundation verification

On 2026-10-01, `pnpm install --lockfile-only --ignore-scripts` passed and
registered the dependency-free workspace. `pnpm --filter @savia/companion test`
passed five synthetic WAV tests, and `audio:inspect --help` passed. Targeted
formatting and local documentation links were checked during integration. These
checks validate this scaffold only. That foundation check preceded desktop implementation; current build/test results
are recorded in the implementation status. The [live-flow smoke test](live-flow-smoke.md) records subsequent real provider
evidence and the remaining native capture failure.

See [Import recordings](recording-imports.md) for local disk, Google Drive, and OneDrive uploads up to 50 MB.

## Application downloads

Integrations → Apps lists published Android, Windows and macOS preview downloads.
See [download publication](downloads.md) for release prerequisites, asset naming
and the distinction between unpublished builds and available downloads.
