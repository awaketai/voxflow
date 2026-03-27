use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{
    traits::consumer::Consumer,
    traits::observer::Observer,
    traits::producer::Producer,
    traits::Split,
    HeapCons,
    HeapProd,
    HeapRb,
};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::ipc::Channel;
use tracing::{error, info};

const TARGET_SAMPLE_RATE: u32 = 16000;
const TARGET_CHANNELS: u16 = 1;
const BUFFER_SIZE: u32 = 1024;
const RING_BUFFER_CAPACITY: usize = 8192;
const PROCESS_INTERVAL_MS: u64 = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioChunk {
    pub base64: String,
    pub duration_ms: u32,
}

pub struct AudioCaptureHandle {
    cancel_token: Arc<Mutex<bool>>,
}

impl AudioCaptureHandle {
    pub fn stop(&self) {
        let mut cancel = self.cancel_token.blocking_lock();
        *cancel = true;
        info!("Audio capture stop requested");
    }
}

/// Start audio capture and spawn a background task to stream chunks.
pub fn start_audio_capture(
    on_audio_chunk: Channel<AudioChunk>,
) -> Result<AudioCaptureHandle, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input device available".to_string())?;

    let device_sample_rate = device
        .default_input_config()
        .map_err(|e| format!("Failed to get device config: {}", e))?
        .sample_rate()
        .0;

    info!(
        "Audio device: {}, native sample rate: {} Hz",
        device.name().unwrap_or_else(|_| "unknown".to_string()),
        device_sample_rate
    );

    let supported_configs: Vec<_> = device
        .supported_input_configs()
        .map_err(|e| format!("Failed to get supported configs: {}", e))?
        .collect();

    let config = find_best_config(&supported_configs, device_sample_rate)
        .ok_or_else(|| {
            format!(
                "No suitable audio config found (need {}Hz Mono)",
                TARGET_SAMPLE_RATE
            )
        })?;

    let sample_rate = config.sample_rate.0;
    let channels = config.channels;

    info!(
        "Audio config: {} Hz, {} channel(s), buffer size: Fixed({})",
        sample_rate, channels, BUFFER_SIZE
    );

    // Create ring buffer and split into producer/consumer
    let rb: HeapRb<i16> = HeapRb::new(RING_BUFFER_CAPACITY);
    let (producer, consumer) = rb.split();

    let ring_producer: Arc<Mutex<HeapProd<i16>>> = Arc::new(Mutex::new(producer));
    let ring_consumer: Arc<Mutex<HeapCons<i16>>> = Arc::new(Mutex::new(consumer));
    let cancel_token = Arc::new(Mutex::new(false));

    // Build the cpal audio stream
    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let rb = ring_producer.clone();
                let Ok(mut guard) = rb.try_lock() else {
                    return;
                };
                let available = guard.vacant_len();
                let to_write = data.len().min(available);
                let samples = if sample_rate != TARGET_SAMPLE_RATE {
                    resample(data, sample_rate, TARGET_SAMPLE_RATE)
                } else {
                    data.to_vec()
                };
                let mono_samples = if channels > TARGET_CHANNELS {
                    to_mono(&samples, channels)
                } else {
                    samples
                };
                let writable = mono_samples.len().min(to_write);
                guard.push_slice(&mono_samples[..writable]);
            },
            |err| error!("Audio stream error: {}", err),
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start audio stream: {}", e))?;
    info!("Audio capture started");

    // Spawn the processing task
    let cancel = cancel_token.clone();
    let on_chunk = on_audio_chunk.clone();

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(
            PROCESS_INTERVAL_MS,
        ));

        loop {
            interval.tick().await;

            {
                let cancel_guard = cancel.lock().await;
                if *cancel_guard {
                    info!("Audio processing task cancelled");
                    break;
                }
            }

            let chunk_data = {
                let Ok(mut guard) = ring_consumer.try_lock() else {
                    continue;
                };
                let available = guard.occupied_len();
                if available == 0 {
                    continue;
                }
                let mut buf = vec![0i16; available];
                guard.pop_slice(&mut buf);
                buf
            };

            if chunk_data.is_empty() {
                continue;
            }

            let byte_slice: &[u8] = unsafe {
                std::slice::from_raw_parts(
                    chunk_data.as_ptr() as *const u8,
                    chunk_data.len() * 2,
                )
            };
            let encoded = base64::engine::general_purpose::STANDARD.encode(byte_slice);
            let duration_ms = (chunk_data.len() as u32 * 1000) / TARGET_SAMPLE_RATE;

            let chunk = AudioChunk {
                base64: encoded,
                duration_ms,
            };

            if let Err(e) = on_chunk.send(chunk) {
                error!("Failed to send audio chunk: {}", e);
                break;
            }
        }
    });

    // Keep the stream alive until the processing task finishes.
    std::mem::forget(stream);

    Ok(AudioCaptureHandle { cancel_token })
}

/// Find the best matching stream config.
fn find_best_config(
    supported: &[cpal::SupportedStreamConfigRange],
    device_sample_rate: u32,
) -> Option<cpal::StreamConfig> {
    // First try: exact match 16kHz Mono
    for range in supported {
        let min_rate = range.min_sample_rate().0;
        let max_rate = range.max_sample_rate().0;
        let ch = range.channels();

        if (min_rate..=max_rate).contains(&TARGET_SAMPLE_RATE) && ch == TARGET_CHANNELS {
            return Some(cpal::StreamConfig {
                channels: TARGET_CHANNELS,
                sample_rate: cpal::SampleRate(TARGET_SAMPLE_RATE),
                buffer_size: cpal::BufferSize::Fixed(BUFFER_SIZE),
            });
        }
    }

    // Fallback: use device native rate, request mono
    for range in supported {
        let ch = range.channels();
        if ch >= TARGET_CHANNELS {
            return Some(cpal::StreamConfig {
                channels: TARGET_CHANNELS,
                sample_rate: cpal::SampleRate(device_sample_rate),
                buffer_size: cpal::BufferSize::Fixed(BUFFER_SIZE),
            });
        }
    }

    // Last resort: use first available config
    supported.first().map(|range| cpal::StreamConfig {
        channels: range.channels().min(2),
        sample_rate: cpal::SampleRate(device_sample_rate),
        buffer_size: cpal::BufferSize::Fixed(BUFFER_SIZE),
    })
}

/// Simple linear interpolation resample from src_rate to dst_rate.
fn resample(data: &[i16], src_rate: u32, dst_rate: u32) -> Vec<i16> {
    if src_rate == dst_rate {
        return data.to_vec();
    }

    let ratio = src_rate as f64 / dst_rate as f64;
    let output_len = (data.len() as f64 / ratio).round() as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = src_pos - idx as f64;

        let curr = *data.get(idx).unwrap_or(&0);
        let next = *data.get(idx + 1).unwrap_or(&curr);
        output.push((curr as f64 + (next - curr) as f64 * frac).round() as i16);
    }

    output
}

/// Convert multi-channel audio to mono by averaging all channels.
fn to_mono(data: &[i16], channels: u16) -> Vec<i16> {
    let ch = channels as usize;
    let mono_len = data.len() / ch;
    let mut output = Vec::with_capacity(mono_len);

    for i in 0..mono_len {
        let mut sum: i32 = 0;
        for c in 0..ch {
            sum += data[i * ch + c] as i32;
        }
        output.push((sum / ch as i32) as i16);
    }

    output
}
