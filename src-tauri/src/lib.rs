mod audio;
mod commands;
mod error;
#[cfg(target_os = "macos")]
mod focus;
mod keys;
mod permissions;
mod shortcut;
mod state;
mod tray;

use anyhow::Result;
use tauri::Manager;

pub use state::AppState;

const APP_PATH: &str = "vox-flow";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    let app_path = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine local data directory"))?
        .join(APP_PATH);
    if !app_path.exists() {
        std::fs::create_dir_all(&app_path)?;
    }

    let state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("vox-flow.log".to_string()),
                    },
                ))
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_state,
            commands::start_audio_capture,
            commands::stop_audio_capture,
            commands::check_accessibility,
            commands::check_microphone,
            commands::check_focus,
            commands::inject_text,
            commands::update_tray_status,
        ])
        .manage(state)
        .setup(|app| {
            // Hide from Dock — menu bar only
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Check and request permissions
            permissions::check_and_request(app.handle());

            // Setup tray icon and menu
            tray::setup(app.handle())?;

            // Register global shortcut
            shortcut::register(app.handle())?;

            // Hide settings window initially
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
