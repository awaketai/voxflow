use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tracing::{error, info};

pub fn register(app: &AppHandle) -> anyhow::Result<()> {
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut("CommandOrControl+Shift+Backslash", move |_app, _shortcut, event| {
            match event.state() {
                ShortcutState::Pressed => {
                    info!("Global shortcut pressed");
                    if let Err(e) = handle.emit("shortcut-pressed", ()) {
                        error!("Failed to emit shortcut-pressed: {}", e);
                    }
                }
                ShortcutState::Released => {
                    info!("Global shortcut released");
                    if let Err(e) = handle.emit("shortcut-released", ()) {
                        error!("Failed to emit shortcut-released: {}", e);
                    }
                }
            }
        })?;

    info!("Global shortcut registered: Cmd+Shift+\\");
    Ok(())
}
