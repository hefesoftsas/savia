use std::time::{Duration, Instant};

use savia_companion_lib::capture::lifecycle::{
    Lifecycle, Source, Sources, State, MAX_PCM_BYTES, MAX_WAV_BYTES,
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
fn capture_duration_is_capped_at_one_hour() {
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
    capture.stop(started + Duration::from_secs(3_700));

    assert_eq!(capture.elapsed, Duration::from_secs(3_600));
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
fn pause_freezes_the_clock_and_resume_excludes_paused_time() {
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

    assert!(capture.pause(started + Duration::from_secs(10)));
    assert_eq!(capture.state, State::Paused);
    // Wall-clock time while paused is not billed as audio.
    assert_eq!(
        capture.elapsed_at(started + Duration::from_secs(50)),
        Duration::from_secs(10)
    );

    let resumed_at = started + Duration::from_secs(50);
    capture.resume(resumed_at).unwrap();
    assert_eq!(capture.state, State::Recording);
    assert_eq!(
        capture.elapsed_at(resumed_at + Duration::from_secs(5)),
        Duration::from_secs(15)
    );
    assert!(capture.stop(resumed_at + Duration::from_secs(5)));
    assert_eq!(capture.elapsed, Duration::from_secs(15));
}

#[test]
fn pause_and_resume_reject_invalid_states_and_stop_finalizes_paused() {
    let mut capture = Lifecycle::default();
    assert!(!capture.pause(Instant::now()));
    assert!(capture.resume(Instant::now()).is_err());

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
    assert!(capture.resume(started).is_err());
    assert!(capture.pause(started + Duration::from_secs(2)));
    // Second pause is a no-op.
    assert!(!capture.pause(started + Duration::from_secs(3)));
    // Stop from paused keeps the frozen elapsed and becomes ready.
    assert!(capture.stop(started + Duration::from_secs(60)));
    assert_eq!(capture.state, State::Ready);
    assert_eq!(capture.elapsed, Duration::from_secs(2));
    assert!(capture.resume(Instant::now()).is_err());
}

#[test]
fn resume_starts_a_new_recording_generation() {
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
    capture.pause(first_start + Duration::from_secs(1));
    let second_start = first_start + Duration::from_secs(30);
    capture.resume(second_start).unwrap();

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
