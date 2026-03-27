import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

/**
 * Copy transcribed text to clipboard and notify the user.
 * Used as fallback when the focused element is not editable.
 */
export async function clipboardFallback(text: string): Promise<void> {
  if (!text) return;

  await writeText(text);

  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }

  if (granted) {
    sendNotification({
      title: "VoxFlow",
      body: "Transcribed text copied to clipboard",
    });
  }

  console.log("[ClipboardFallback] Text copied to clipboard:", text.length, "chars");
}
