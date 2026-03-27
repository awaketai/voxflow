use std::sync::atomic::{AtomicBool, Ordering};

use tracing::info;

use crate::audio::AudioCaptureHandle;

#[derive(Clone)]
pub struct AppState {
    recording: std::sync::Arc<AtomicBool>,
    audio_handle: std::sync::Arc<std::sync::Mutex<Option<AudioCaptureHandle>>>,
}

impl AppState {
    pub fn new() -> Self {
        info!("Initializing app state");
        Self {
            recording: std::sync::Arc::new(AtomicBool::new(false)),
            audio_handle: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::Relaxed)
    }

    pub fn set_recording(&self, value: bool) {
        self.recording.store(value, Ordering::Relaxed);
    }

    pub fn set_audio_handle(&self, handle: Option<AudioCaptureHandle>) {
        let mut guard = self.audio_handle.lock().expect("Audio handle lock poisoned");
        *guard = handle;
    }

    pub fn stop_audio_capture(&self) {
        let mut guard = self.audio_handle.lock().expect("Audio handle lock poisoned");
        if let Some(handle) = guard.take() {
            handle.stop();
        }
        self.set_recording(false);
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
