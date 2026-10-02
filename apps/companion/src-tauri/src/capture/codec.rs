//! Bounded Opus/Ogg encoding for completed capture tracks.
//!
//! Captures are converted to mono, 48 kHz, fullband Opus at 32 kbit/s. The
//! encoder uses ruopus (MIT); unsupported native rates are resampled with
//! Rubato's Blackman-Harris-windowed FFT resampler. This band-limited
//! conversion is speech-review quality, not a bit-identical libopus resample.
//! Ogg Opus stores the effective duration in 48 kHz granules. The last packet
//! is zero-padded to 20 ms, then the EOS granule trims that padding; pre-skip
//! 69 removes the encoder's hybrid-mode delay.

use rubato::{Fft, FixedSync, Resampler};
use ruopus::{
    ogg::{OggOpusReader, OggOpusWriter, OpusHead, OpusTags, PageReader},
    Bandwidth, OpusEncoder,
};

use super::{audio::RawAudio, lifecycle::MAX_PCM_BYTES};

pub const OPUS_BITRATE_BPS: u32 = 32_000;
pub const MAX_OGG_BYTES: usize = 512 * 1024;
const OPUS_RATE: u32 = 48_000;
const FRAME_SAMPLES: usize = 960;
const PRE_SKIP: u16 = 69;

#[derive(Clone, Debug)]
pub struct EncodedAudio {
    pub ogg: Vec<u8>,
    pub sample_rate: u32,
    pub duration_seconds: f64,
}

pub fn encode_ogg_opus(audio: RawAudio) -> Result<EncodedAudio, String> {
    if let Some(error) = audio.error {
        return Err(error);
    }
    if audio.pcm.is_empty()
        || audio.pcm.len() > MAX_PCM_BYTES
        || audio.pcm.len() % 2 != 0
        || !(8_000..=96_000).contains(&audio.sample_rate)
    {
        return Err(
            "Captured PCM is empty, malformed, oversized, or has an unsupported rate.".into(),
        );
    }
    let input_frames = audio.pcm.len() / 2;
    let input_duration = input_frames as f64 / audio.sample_rate as f64;
    if input_duration <= 0.0 || input_duration > 60.0 {
        return Err("Captured audio must be at most 60 seconds.".into());
    }
    let input: Vec<f32> = audio
        .pcm
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f32 / 32768.0)
        .collect();
    let expected_output_frames = ((input_frames as u64 * u64::from(OPUS_RATE)
        + u64::from(audio.sample_rate) / 2)
        / u64::from(audio.sample_rate)) as usize;
    let mut samples = if audio.sample_rate == OPUS_RATE {
        input
    } else {
        resample_mono(&input, audio.sample_rate, OPUS_RATE)?
    };
    // Rubato returns a ceiling-sized buffer. Conform to nearest output sample
    // so effective Ogg duration differs from source by at most half a 48 kHz
    // sample and never exceeds the 60-second cap.
    samples.resize(expected_output_frames, 0.0);
    if samples.is_empty() || samples.len() > OPUS_RATE as usize * 60 {
        return Err("Resampling produced an invalid duration.".into());
    }

    let mut encoder = OpusEncoder::new(1);
    encoder.set_bandwidth(Bandwidth::FullBand);
    encoder.set_bitrate(Some(OPUS_BITRATE_BPS));
    let head = OpusHead::family0(1, PRE_SKIP, audio.sample_rate);
    let tags = OpusTags {
        vendor: b"Savia Companion (ruopus)".to_vec(),
        comments: Vec::new(),
    };
    let mut writer = OggOpusWriter::new(&head, &tags, 0x5341_5649);

    let target_granule = u64::from(PRE_SKIP) + samples.len() as u64;
    let packet_count = (target_granule as usize).div_ceil(FRAME_SAMPLES);
    for index in 0..packet_count {
        let start = index * FRAME_SAMPLES;
        let end = (start + FRAME_SAMPLES).min(samples.len());
        let mut frame = vec![0.0; FRAME_SAMPLES];
        if start < end {
            frame[..end - start].copy_from_slice(&samples[start..end]);
        }
        let packet = encoder
            .encode_auto(&frame, 1275)
            .map_err(|_| "Could not encode a captured audio frame.".to_string())?;
        writer.push(&packet, index + 1 == packet_count);
    }
    let mut ogg = writer.finish();
    set_eos_granule(&mut ogg, target_granule)?;
    if ogg.len() > MAX_OGG_BYTES {
        return Err("Compressed audio exceeds the 512 KiB per-track limit.".into());
    }
    // Verify generated Ogg structure and effective duration using the codec's
    // independent reader before making bytes available to the renderer.
    let reader = OggOpusReader::new(&ogg)
        .map_err(|_| "Could not validate the encoded Ogg Opus track.".to_string())?;
    if reader.head().channel_count != 1
        || reader.head().pre_skip != PRE_SKIP
        || reader.pcm_duration_48k() != Some(samples.len() as u64)
    {
        return Err("Encoded Ogg Opus track has an invalid duration or layout.".into());
    }
    Ok(EncodedAudio {
        ogg,
        sample_rate: OPUS_RATE,
        duration_seconds: samples.len() as f64 / f64::from(OPUS_RATE),
    })
}

fn resample_mono(input: &[f32], input_rate: u32, output_rate: u32) -> Result<Vec<f32>, String> {
    use rubato::audioadapter_buffers::owned::InterleavedOwned;
    use rubato::WindowFunction;
    let input_buffer = InterleavedOwned::new_from(input.to_vec(), 1, input.len())
        .map_err(|_| "Could not prepare audio for resampling.".to_string())?;
    let mut resampler = Fft::<f32>::new_custom(
        input_rate as usize,
        output_rate as usize,
        1_024,
        1,
        1,
        WindowFunction::BlackmanHarris2,
        FixedSync::Both,
    )
    .map_err(|_| "Could not initialize the audio resampler.".to_string())?;
    resampler
        .process_all(&input_buffer, input.len(), None)
        .map(InterleavedOwned::take_data)
        .map_err(|_| "Could not resample captured audio.".to_string())
}

/// ruopus starts every audio-page granule at pre-skip and always writes a full
/// packet duration. Rebase non-EOS pages to decoded-sample positions and trim
/// the final packet with the RFC 7845 EOS granule, recalculating each changed
/// page's Ogg CRC. This keeps page anchors, decoder output and duration aligned.
fn set_eos_granule(ogg: &mut [u8], granule: u64) -> Result<(), String> {
    let mut offset = 0;
    let mut found_eos = false;
    while offset < ogg.len() {
        let page = PageReader::new(&ogg[offset..])
            .next()
            .ok_or_else(|| "Could not parse encoded Ogg page.".to_string())?;
        let table_len = usize::from(ogg[offset + 26]);
        let body_len = ogg[offset + 27..offset + 27 + table_len]
            .iter()
            .map(|length| usize::from(*length))
            .sum::<usize>();
        let page_end = offset + 27 + table_len + body_len;
        if page.sequence >= 2 && page.granule_position != u64::MAX {
            // OggOpusWriter starts audio granules at pre-skip. RFC 7845 audio
            // page positions use decoded samples; remove that initial offset
            // on non-EOS pages. The EOS page records pre-skip + effective PCM
            // length to express final packet trimming.
            let page_granule = if page.eos {
                found_eos = true;
                granule
            } else {
                page.granule_position
                    .checked_sub(u64::from(PRE_SKIP))
                    .ok_or_else(|| "Encoded Ogg audio page precedes its pre-skip.".to_string())?
            };
            ogg[offset + 6..offset + 14].copy_from_slice(&page_granule.to_le_bytes());
            ogg[offset + 22..offset + 26].fill(0);
            let checksum = ogg_crc(&ogg[offset..page_end]);
            ogg[offset + 22..offset + 26].copy_from_slice(&checksum.to_le_bytes());
        }
        offset = page_end;
    }
    if !found_eos {
        return Err("Encoded Ogg stream has no EOS page.".into());
    }
    Ok(())
}

fn ogg_crc(bytes: &[u8]) -> u32 {
    let mut crc = 0u32;
    for byte in bytes {
        crc ^= u32::from(*byte) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use ruopus::{decode_ogg_opus, ogg::PageReader};
    use std::process::Command;

    fn ffmpeg_sample_count(ogg: &[u8]) -> Option<usize> {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), ogg).unwrap();
        let output = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(file.path())
            .args([
                "-map",
                "0:a:0",
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "48000",
                "pipe:1",
            ])
            .output()
            .ok()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(output.stdout.len() % 2, 0);
        Some(output.stdout.len() / 2)
    }

    fn sine(rate: u32, frames: usize) -> RawAudio {
        let mut pcm = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let sample = ((frame as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin()
                * 12_000.0) as i16;
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        RawAudio {
            pcm,
            sample_rate: rate,
            error: None,
        }
    }

    #[test]
    fn encodes_short_non_frame_aligned_44100_hz_audio_without_truncation() {
        let original = sine(44_100, 6_041);
        let expected_output_frames = (6_041u64 * 48_000 + 22_050) / 44_100;
        let encoded = encode_ogg_opus(original).unwrap();
        let (decoded, head) = decode_ogg_opus(&encoded.ogg).unwrap();
        assert_eq!(encoded.sample_rate, 48_000);
        assert_eq!(head.input_sample_rate, 44_100);
        assert_eq!(head.channel_count, 1);
        assert_eq!(head.pre_skip, PRE_SKIP);
        assert_eq!(decoded.len(), expected_output_frames as usize);
        assert_eq!(encoded.duration_seconds, decoded.len() as f64 / 48_000.0);
        assert!(decoded.iter().any(|sample| sample.abs() > 0.001));
        if let Some(external_frames) = ffmpeg_sample_count(&encoded.ogg) {
            assert_eq!(
                external_frames, expected_output_frames as usize,
                "libopus/ffmpeg must apply pre-skip and EOS trimming exactly"
            );
        } else {
            eprintln!("ffmpeg unavailable; external sample-count check skipped");
        }
        assert_eq!(
            OggOpusReader::new(&encoded.ogg).unwrap().pcm_duration_48k(),
            Some(decoded.len() as u64)
        );
        let pages = PageReader::new(&encoded.ogg).collect::<Vec<_>>();
        assert!(pages.last().unwrap().eos);
    }

    #[test]
    fn rejects_invalid_sample_rates_empty_odd_or_oversize_pcm() {
        for rate in [0, 7_999, 96_001] {
            assert!(encode_ogg_opus(sine(rate, 1)).is_err());
        }
        assert!(encode_ogg_opus(RawAudio {
            pcm: vec![],
            sample_rate: 16_000,
            error: None
        })
        .is_err());
        assert!(encode_ogg_opus(RawAudio {
            pcm: vec![1],
            sample_rate: 16_000,
            error: None
        })
        .is_err());
        assert!(encode_ogg_opus(RawAudio {
            pcm: vec![1; MAX_PCM_BYTES + 1],
            sample_rate: 16_000,
            error: None
        })
        .is_err());
    }

    #[test]
    fn sixty_seconds_stays_within_encoded_bound_and_pcm_cap() {
        let encoded = encode_ogg_opus(sine(16_000, 16_000 * 60)).unwrap();
        assert!((encoded.duration_seconds - 60.0).abs() <= 1.0 / 48_000.0);
        assert!(encoded.ogg.len() <= MAX_OGG_BYTES);
        assert!(
            encoded.ogg.len() < 300_000,
            "32 kbit/s target should be near 240 KiB plus headers"
        );
        if let Some(external_frames) = ffmpeg_sample_count(&encoded.ogg) {
            assert_eq!(
                external_frames,
                48_000 * 60,
                "external decoder must trim to 60 seconds exactly"
            );
        } else {
            eprintln!("ffmpeg unavailable; external sample-count check skipped");
        }
    }

    #[test]
    fn output_is_decoded_by_ffmpeg_when_available() {
        let encoded = encode_ogg_opus(sine(44_100, 6_041)).unwrap();
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), &encoded.ogg).unwrap();
        let probe = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,sample_rate,channels",
                "-of",
                "default=nw=1",
            ])
            .arg(file.path())
            .output();
        let Ok(probe) = probe else {
            eprintln!("ffprobe unavailable; ruopus decode test still ran");
            return;
        };
        assert!(
            probe.status.success(),
            "{}",
            String::from_utf8_lossy(&probe.stderr)
        );
        let metadata = String::from_utf8_lossy(&probe.stdout);
        assert!(metadata.contains("codec_name=opus"), "{metadata}");
        assert!(metadata.contains("channels=1"), "{metadata}");
        assert_eq!(
            ffmpeg_sample_count(&encoded.ogg),
            Some((6_041u64 * 48_000 + 22_050).div_euclid(44_100) as usize)
        );
    }
}
