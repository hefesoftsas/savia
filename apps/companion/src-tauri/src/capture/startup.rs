//! Independent bounded startup attempts; a failing source cannot tear down its peer.

pub const SOURCE_START_ATTEMPTS: usize = 3;

pub struct StartedSources<M, S> {
    pub microphone: Option<M>,
    pub system: Option<S>,
    pub microphone_error: Option<String>,
    pub system_error: Option<String>,
}

pub fn start_available_sources<M, S>(
    mut microphone: impl FnMut() -> Result<M, String>,
    mut system: impl FnMut() -> Result<S, String>,
    mut wait: impl FnMut(),
) -> StartedSources<M, S> {
    let mut result = StartedSources {
        microphone: None,
        system: None,
        microphone_error: None,
        system_error: None,
    };
    for attempt in 0..SOURCE_START_ATTEMPTS {
        if result.microphone.is_none() {
            match microphone() {
                Ok(handle) => {
                    result.microphone = Some(handle);
                    result.microphone_error = None;
                }
                Err(error) => result.microphone_error = Some(error),
            }
        }
        if result.system.is_none() {
            match system() {
                Ok(handle) => {
                    result.system = Some(handle);
                    result.system_error = None;
                }
                Err(error) => result.system_error = Some(error),
            }
        }
        if result.microphone.is_some() && result.system.is_some() {
            break;
        }
        if attempt + 1 < SOURCE_START_ATTEMPTS {
            wait();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_a_successful_source_while_retrying_its_peer() {
        let (mut mic_calls, mut system_calls, mut waits) = (0, 0, 0);
        let result = start_available_sources(
            || {
                mic_calls += 1;
                Ok(17)
            },
            || {
                system_calls += 1;
                Err::<u32, _>("unavailable".into())
            },
            || waits += 1,
        );
        assert_eq!(result.microphone, Some(17));
        assert_eq!(result.system, None);
        assert_eq!((mic_calls, system_calls, waits), (1, 3, 2));
        assert_eq!(result.microphone_error, None);
        assert_eq!(result.system_error.as_deref(), Some("unavailable"));
    }

    #[test]
    fn recovers_a_transient_source_without_restart_of_the_successful_one() {
        let (mut mic_calls, mut system_calls, mut waits) = (0, 0, 0);
        let result = start_available_sources(
            || {
                mic_calls += 1;
                if mic_calls < 3 {
                    Err("transient".into())
                } else {
                    Ok(7)
                }
            },
            || {
                system_calls += 1;
                Ok(8)
            },
            || waits += 1,
        );
        assert_eq!(result.microphone, Some(7));
        assert_eq!(result.system, Some(8));
        assert_eq!(result.microphone_error, None);
        assert_eq!((mic_calls, system_calls, waits), (3, 1, 2));
    }

    #[test]
    fn bounds_total_failure_and_does_not_retry_success() {
        let (mut mic_calls, mut system_calls, mut waits) = (0, 0, 0);
        let result = start_available_sources(
            || {
                mic_calls += 1;
                Err::<u32, _>("mic".into())
            },
            || {
                system_calls += 1;
                Err::<u32, _>("system".into())
            },
            || waits += 1,
        );
        assert!(result.microphone.is_none() && result.system.is_none());
        assert_eq!((mic_calls, system_calls, waits), (3, 3, 2));
    }
}
