use std::time::{Duration, Instant};

use savia_companion_lib::capture::lifecycle::{
    Lifecycle, Source, Sources, State, MAX_CAPTURE_DURATION, MAX_PCM_BYTES, MAX_WAV_BYTES,
};

#[test]
fn invalid_no_sources_start_is_rejected() {
    let mut capture = Lifecycle::default();
    assert!(capture.start(Sources::default(), Instant::now()).is_err());
    assert_eq!(capture.state, State::Idle);
}

#[test]
fn read_is_only_allowed_when_capture_is_ready() {
    let mut capture = Lifecycle::default();
    let started = Instant::now();
    capture
        .start(
            Sources {
                microphone: true,
                system: false,
            },
            started,
        )
        .unwrap();

    assert!(!capture.can_read(Source::Microphone));
    assert!(capture.stop(started + Duration::from_secs(1)));
    assert!(capture.can_read(Source::Microphone));
    assert!(!capture.can_read(Source::System));
}

#[test]
fn stop_is_idempotent_and_discard_resets_session() {
    let mut capture = Lifecycle::default();
    let started = Instant::now();
    capture
        .start(
            Sources {
                microphone: true,
                system: true,
            },
            started,
        )
        .unwrap();

    assert!(capture.stop(started + Duration::from_secs(3)));
    assert!(!capture.stop(started + Duration::from_secs(4)));
    assert_eq!(capture.elapsed, Duration::from_secs(3));
    capture.discard();
    assert_eq!(capture.state, State::Idle);
    assert!(capture.tracks.is_empty());
}

#[test]
fn capture_duration_is_capped_at_sixty_seconds() {
    let mut capture = Lifecycle::default();
    let started = Instant::now();
    capture
        .start(
            Sources {
                microphone: true,
                system: false,
            },
            started,
        )
        .unwrap();
    capture.stop(started + Duration::from_secs(70));

    assert_eq!(capture.elapsed, MAX_CAPTURE_DURATION);
}

#[test]
fn track_size_is_capped_at_eight_mib() {
    let capture = Lifecycle::default();
    assert_eq!(
        capture.ensure_track_size(MAX_PCM_BYTES - 1, 1).unwrap(),
        MAX_PCM_BYTES
    );
    assert!(capture.ensure_track_size(MAX_PCM_BYTES, 1).is_err());
    assert_eq!(MAX_PCM_BYTES + 44, MAX_WAV_BYTES);
}

#[test]
fn auto_stop_timer_must_match_the_current_recording_generation() {
    let mut capture = Lifecycle::default();
    let first_start = Instant::now();
    capture
        .start(
            Sources {
                microphone: true,
                system: false,
            },
            first_start,
        )
        .unwrap();
    capture.discard();

    let second_start = first_start + Duration::from_secs(2);
    capture
        .start(
            Sources {
                microphone: false,
                system: true,
            },
            second_start,
        )
        .unwrap();

    assert!(!capture.is_recording_generation(first_start));
    assert!(capture.is_recording_generation(second_start));
}

#[test]
fn recording_clock_starts_after_permission_and_device_setup() {
    let mut capture = Lifecycle::default();
    let requested_at = Instant::now();
    capture
        .start(
            Sources {
                microphone: true,
                system: true,
            },
            requested_at,
        )
        .unwrap();
    let devices_ready_at = requested_at + Duration::from_secs(12);
    capture.reanchor_start(devices_ready_at);

    assert_eq!(
        capture.elapsed_at(devices_ready_at + Duration::from_secs(2)),
        Duration::from_secs(2)
    );
    assert!(!capture.is_recording_generation(requested_at));
    assert!(capture.is_recording_generation(devices_ready_at));
}
