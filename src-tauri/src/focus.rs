use accessibility::AXUIElement;
use accessibility::AXUIElementAttributes;
use accessibility::AXAttribute;
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::CFString;
use serde::Serialize;
use tracing::warn;

const EDITABLE_ROLES: &[&str] = &[
    "AXTextField",
    "AXTextArea",
    "AXComboBox",
    "AXSearchField",
    "AXWebArea",
];

const FOCUSED_UI_ELEMENT_ATTR: &str = "AXFocusedUIElement";
const MAX_PREVIOUS_TEXT_LEN: usize = 50;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FocusResult {
    Editable { previous_text: String },
    NotEditable,
    DetectionFailed(String),
}

/// Check the currently focused UI element and determine if it's editable.
pub fn check_focus() -> FocusResult {
    let system = AXUIElement::system_wide();
    let focused_attr = AXAttribute::<CFType>::new(&CFString::new(FOCUSED_UI_ELEMENT_ATTR));

    let focused: AXUIElement = match system.attribute::<CFType>(&focused_attr) {
        Ok(val) => {
            let ptr = val.as_CFTypeRef() as *mut _;
            unsafe { AXUIElement::wrap_under_get_rule(ptr) }
        }
        Err(e) => {
            warn!("[Focus] Cannot get focused element: {:?}", e);
            return FocusResult::DetectionFailed(format!(
                "Cannot get focused element: {:?}",
                e
            ));
        }
    };

    // Get role
    let role = match focused.role() {
        Ok(r) => r.to_string(),
        Err(e) => {
            warn!("[Focus] Cannot get role: {:?}", e);
            return FocusResult::DetectionFailed(format!(
                "Cannot get element role: {:?}",
                e
            ));
        }
    };

    // Check if role is in editable whitelist
    if !EDITABLE_ROLES.contains(&role.as_str()) {
        tracing::info!("[Focus] Role '{}' is not editable", role);
        return FocusResult::NotEditable;
    }

    // Check if value attribute is settable (confirms editability)
    let is_settable = is_value_settable(&focused);

    if !is_settable {
        tracing::info!("[Focus] Role '{}' but value is not settable", role);
        return FocusResult::NotEditable;
    }

    // Try to get current value as previous_text context
    let previous_text = extract_value_text(&focused);

    tracing::info!(
        "[Focus] Editable element: role={}, previous_text={:?}",
        role,
        previous_text
    );

    FocusResult::Editable { previous_text }
}

/// Check if the value attribute of an AXUIElement is settable.
fn is_value_settable(element: &AXUIElement) -> bool {
    let mut settable: core_foundation::base::Boolean = 0;
    let result = unsafe {
        accessibility_sys::AXUIElementIsAttributeSettable(
            element.as_CFTypeRef() as accessibility_sys::AXUIElementRef,
            core_foundation::string::CFString::new("AXValue").as_concrete_TypeRef(),
            &mut settable,
        )
    };

    if result != 0 {
        warn!("[Focus] AXUIElementIsAttributeSettable failed: {}", result);
        // If we can't determine settable, assume editable for AXWebArea
        return true;
    }

    settable != 0
}

/// Extract text value from an AXUIElement's value attribute.
fn extract_value_text(element: &AXUIElement) -> String {
    match element.value() {
        Ok(val) => {
            let val_type_id = val.type_of();
            let string_type_id = CFString::type_id();

            if val_type_id == string_type_id {
                let s = unsafe {
                    CFString::wrap_under_get_rule(val.as_CFTypeRef() as *const _)
                };
                let full = s.to_string();
                if full.len() > MAX_PREVIOUS_TEXT_LEN {
                    let end = full
                        .char_indices()
                        .nth(MAX_PREVIOUS_TEXT_LEN)
                        .map(|(i, _)| i)
                        .unwrap_or(full.len());
                    full[end..].to_string()
                } else {
                    full
                }
            } else {
                String::new()
            }
        }
        Err(_) => String::new(),
    }
}
