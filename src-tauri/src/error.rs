use thiserror::Error;

#[derive(Error, Debug)]
pub enum VoxError {
    #[error("Audio error: {0}")]
    Audio(String),

    #[error("Shortcut error: {0}")]
    Shortcut(String),

    #[error("Focus detection error: {0}")]
    Focus(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Permission error: {0}")]
    Permission(String),

    #[error("Key simulation error: {0}")]
    KeySimulation(String),

    #[error("Store error: {0}")]
    Store(String),

    #[error("Window error: {0}")]
    Window(String),
}

impl From<tauri::Error> for VoxError {
    fn from(e: tauri::Error) -> Self {
        VoxError::Window(e.to_string())
    }
}
