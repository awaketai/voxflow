use tauri::AppHandle;
use tracing::{info, warn};

#[cfg(target_os = "macos")]
use macos_accessibility_client::accessibility::{
    application_is_trusted, application_is_trusted_with_prompt,
};

pub fn check_and_request(_app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if application_is_trusted() {
            info!("Accessibility permission granted");
        } else {
            warn!("Accessibility permission not granted, requesting...");
            application_is_trusted_with_prompt();
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        tracing::warn!("Accessibility permission check is only supported on macOS");
    }
}
