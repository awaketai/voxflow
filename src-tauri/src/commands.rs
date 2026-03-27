use tauri::{command, ipc::Channel, State};
use tauri_plugin_store::StoreExt;

use crate::audio::AudioChunk;
use crate::keys::InjectTextCommand;
use crate::state::AppState;

const STORE_PATH: &str = "config.json";

fn get_or_create_store(
    app: &tauri::AppHandle,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    app.store(STORE_PATH).map_err(|e| e.to_string())
}

#[command]
pub fn get_config(app: tauri::AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let store = get_or_create_store(&app)?;
    Ok(store.get(&key))
}

#[command]
pub fn set_config(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let store = get_or_create_store(&app)?;
    store.set(&key, value);
    store.save().map_err(|e| e.to_string())
}

#[command]
pub fn get_state(state: State<'_, AppState>) -> bool {
    state.is_recording()
}

#[command]
pub fn start_audio_capture(
    state: State<'_, AppState>,
    on_audio_chunk: Channel<AudioChunk>,
) -> Result<(), String> {
    if state.is_recording() {
        return Err("Audio capture is already running".into());
    }

    let handle = crate::audio::start_audio_capture(on_audio_chunk)?;
    state.set_recording(true);
    state.set_audio_handle(Some(handle));
    Ok(())
}

#[command]
pub fn stop_audio_capture(state: State<'_, AppState>) -> Result<(), String> {
    if !state.is_recording() {
        return Err("Audio capture is not running".into());
    }

    state.stop_audio_capture();
    Ok(())
}

#[cfg(target_os = "macos")]
#[command]
pub fn check_accessibility() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted()
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn check_accessibility() -> bool {
    false
}

#[command]
pub fn check_microphone() -> bool {
    true
}

#[cfg(target_os = "macos")]
#[command]
pub fn check_focus() -> Result<crate::focus::FocusResult, String> {
    Ok(crate::focus::check_focus())
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn check_focus() -> Result<crate::focus::FocusResult, String> {
    Err("Focus detection is only supported on macOS".into())
}

#[cfg(target_os = "macos")]
#[command]
pub fn inject_text(command: InjectTextCommand) -> Result<(), String> {
    crate::keys::inject_text(command)
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn inject_text(_command: InjectTextCommand) -> Result<(), String> {
    Err("Text injection is only supported on macOS".into())
}

#[command]
pub fn update_tray_status(app: tauri::AppHandle, status: String) {
    crate::tray::update_tray_status(&app, &status);
}
