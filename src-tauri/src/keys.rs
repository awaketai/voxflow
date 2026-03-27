use core_graphics::event::{CGEvent, CGEventTapLocation, KeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::thread;
use std::time::Duration;
use tracing::info;

const BACKSPACE_KEYCODE: u16 = KeyCode::DELETE;
const MAX_CHARS_PER_EVENT: usize = 20;
const BACKSPACE_INTERVAL: Duration = Duration::from_micros(20);
const CHAR_INPUT_INTERVAL: Duration = Duration::from_micros(50);

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectTextCommand {
    pub backspaces: u32,
    pub text: String,
}

/// Inject text into the currently focused element using CGEvent keyboard simulation.
pub fn inject_text(command: InjectTextCommand) -> Result<(), String> {
    let InjectTextCommand { backspaces, text } = command;

    if backspaces == 0 && text.is_empty() {
        return Ok(());
    }

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    // Phase 1: Send backspace key events
    for _ in 0..backspaces {
        send_backspace(&source)?;
        thread::sleep(BACKSPACE_INTERVAL);
    }

    // Phase 2: Send text via Unicode keyboard events
    if !text.is_empty() {
        let chars: Vec<char> = text.chars().collect();
        for chunk in chars.chunks(MAX_CHARS_PER_EVENT) {
            let chunk_str: String = chunk.iter().collect();
            send_unicode_text(&source, &chunk_str)?;
            thread::sleep(CHAR_INPUT_INTERVAL);
        }
    }

    info!(
        "[Keys] Injected: {} backspaces + {} chars",
        backspaces,
        text.chars().count()
    );

    Ok(())
}

fn send_backspace(source: &CGEventSource) -> Result<(), String> {
    let key_down = CGEvent::new_keyboard_event(source.clone(), BACKSPACE_KEYCODE, true)
        .map_err(|_| "Failed to create backspace key-down event".to_string())?;

    let key_up = CGEvent::new_keyboard_event(source.clone(), BACKSPACE_KEYCODE, false)
        .map_err(|_| "Failed to create backspace key-up event".to_string())?;

    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

fn send_unicode_text(source: &CGEventSource, text: &str) -> Result<(), String> {
    let key_down = CGEvent::new_keyboard_event(source.clone(), 0, true)
        .map_err(|_| "Failed to create text key-down event".to_string())?;

    let key_up = CGEvent::new_keyboard_event(source.clone(), 0, false)
        .map_err(|_| "Failed to create text key-up event".to_string())?;

    key_down.set_string(text);
    key_up.set_string(text);

    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}
