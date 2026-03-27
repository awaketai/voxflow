import { invoke } from "@tauri-apps/api/core";

export interface FocusEditable {
  type: "editable";
  previousText: string;
}

export interface FocusNotEditable {
  type: "notEditable";
}

export interface FocusDetectionFailed {
  type: "detectionFailed";
}

export type FocusResult = FocusEditable | FocusNotEditable | FocusDetectionFailed;

/**
 * Check if the currently focused UI element is editable.
 * Returns the type of focus result, with optional previousText for editable fields.
 */
export async function checkFocus(): Promise<FocusResult> {
  return invoke<FocusResult>("check_focus");
}

export function isEditable(result: FocusResult): result is FocusEditable {
  return result.type === "editable";
}
