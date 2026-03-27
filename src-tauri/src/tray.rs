use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use std::sync::LazyLock;
use std::sync::Mutex;
use tracing::info;

/// Store the current tray status text.
static CURRENT_STATUS: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new(String::from("Ready")));

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let handle = app.clone();

    let settings_item = MenuItemBuilder::with_id("settings", "Preferences...").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit VoxFlow").build(app)?;

    let menu = build_menu(app, &settings_item, &quit_item)?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("No default icon found"))?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("VoxFlow - Voice to Text")
        .show_menu_on_left_click(false)
        .build(app)?;

    // Handle tray icon clicks
    let on_tray_handle = handle.clone();
    app.on_tray_icon_event(move |_tray, event| {
        use tauri::tray::{MouseButton, TrayIconEvent};
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state,
            ..
        } = event
        {
            if matches!(button_state, tauri::tray::MouseButtonState::Down) {
                if let Some(window) = on_tray_handle.get_webview_window("main") {
                    match window.is_visible() {
                        Ok(true) => {
                            let _ = window.hide();
                        }
                        _ => {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        }
    });

    // Handle menu item clicks
    let on_menu_handle = handle.clone();
    app.on_menu_event(move |_app, event| {
        match event.id.as_ref() {
            "settings" => {
                if let Some(window) = on_menu_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                on_menu_handle.exit(0);
            }
            _ => {}
        }
    });

    info!("Tray icon setup complete");
    Ok(())
}

fn build_menu(
    app: &AppHandle,
    settings_item: &tauri::menu::MenuItem<tauri::Wry>,
    quit_item: &tauri::menu::MenuItem<tauri::Wry>,
) -> anyhow::Result<tauri::menu::Menu<tauri::Wry>> {
    let status_label = {
        let guard = CURRENT_STATUS.lock().expect("Status lock poisoned");
        format!("Status: {}", *guard)
    };

    let status_item = MenuItemBuilder::with_id("status", &status_label)
        .enabled(false)
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .item(settings_item)
        .separator()
        .item(quit_item)
        .build()?;

    Ok(menu)
}

/// Update the tray status text. Called from the `update_tray_status` Tauri command.
pub fn update_tray_status(app: &AppHandle, status: &str) {
    {
        let mut guard = CURRENT_STATUS.lock().expect("Status lock poisoned");
        if *guard == status {
            return;
        }
        *guard = status.to_string();
    }

    if let Some(tray) = app.tray_by_id("main") {
        let settings_item = MenuItemBuilder::with_id("settings", "Preferences...")
            .build(app)
            .ok();
        let quit_item = MenuItemBuilder::with_id("quit", "Quit VoxFlow")
            .build(app)
            .ok();

        if let (Some(settings), Some(quit)) = (settings_item, quit_item) {
            if let Ok(menu) = build_menu(app, &settings, &quit) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    }
}
