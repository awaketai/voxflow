import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionState, ScribeError, ScribeErrorType, DiffResult } from "../types";
import { ScribeClient } from "../scribe-client";
import {
  startAudioCapture,
  stopAudioCapture,
} from "../audio-capture";
import {
  computeDiff,
  flushThrottledDiff,
} from "../diff-engine";
import { checkFocus, isEditable } from "../focus-check";
import { clipboardFallback } from "../clipboard-fallback";
import { useConfigStore } from "./config-store";

interface TranscriptionStoreState {
  state: TranscriptionState;
  lastError: ScribeError | null;
  partialText: string;
  committedText: string;
  focusEditable: boolean | null;
}

interface TranscriptionStoreActions {
  handleShortcutPressed: () => Promise<void>;
  handleShortcutReleased: () => Promise<void>;
  reset: () => void;
}

type TranscriptionStore = TranscriptionStoreState &
  TranscriptionStoreActions;

// Module-level singletons (not per-store-instance)
let scribeClient: ScribeClient | null = null;
let currentOutputText = "";
let throttledDiffTimer: ReturnType<typeof setTimeout> | null = null;
let lastDiffCallTime = 0;
let pendingCurrentText = "";
let pendingNewText = "";
let currentFocusEditable = false;
let previousTextContext = "";
let reconnectAttempted = false;

const THROTTLE_INTERVAL_MS = 50;
const RECONNECT_DELAY_MS = 1000;

const TRAY_STATUS_MAP: Record<TranscriptionState, string> = {
  idle: "Ready",
  initializing: "Connecting...",
  waiting_session: "Waiting...",
  recording: "Recording",
  finalizing: "Finalizing...",
};

function emitTrayStatus(state: TranscriptionState): void {
  const label = TRAY_STATUS_MAP[state] ?? state;
  invoke("update_tray_status", { status: label }).catch(() => {});
}

function processDiff(
  currentText: string,
  newText: string,
  callback: (diff: DiffResult) => void
): void {
  const diff = computeDiff(currentText, newText);
  if (diff.backspaces === 0 && diff.newText === "") return;
  callback(diff);
}

function throttledDiff(
  currentText: string,
  newText: string,
  callback: (diff: DiffResult) => void
): void {
  pendingCurrentText = currentText;
  pendingNewText = newText;

  const now = Date.now();
  if (now - lastDiffCallTime >= THROTTLE_INTERVAL_MS) {
    lastDiffCallTime = now;
    processDiff(currentText, newText, callback);
  } else if (!throttledDiffTimer) {
    throttledDiffTimer = setTimeout(() => {
      throttledDiffTimer = null;
      processDiff(pendingCurrentText, pendingNewText, callback);
    }, THROTTLE_INTERVAL_MS);
  }
}

function flushPendingDiff(
  callback: (diff: DiffResult) => void
): void {
  if (throttledDiffTimer) {
    clearTimeout(throttledDiffTimer);
    throttledDiffTimer = null;
  }
  if (pendingCurrentText !== pendingNewText) {
    processDiff(pendingCurrentText, pendingNewText, callback);
  }
}

/** Inject a diff into the focused element via CGEvent key simulation. */
async function injectDiff(diff: DiffResult): Promise<void> {
  if (!currentFocusEditable) return;

  try {
    await invoke("inject_text", {
      command: {
        backspaces: diff.backspaces,
        text: diff.newText,
      },
    });
  } catch (err) {
    console.error("[Transcription] inject_text failed:", err);
  }
}

/** Clean up all resources and return to idle state. */
function cleanup(set: (partial: Partial<TranscriptionStore>) => void, extra?: Partial<TranscriptionStore>) {
  scribeClient?.disconnect();
  scribeClient = null;
  reconnectAttempted = false;
  currentOutputText = "";
  previousTextContext = "";
  if (throttledDiffTimer) {
    clearTimeout(throttledDiffTimer);
    throttledDiffTimer = null;
  }
  set({
    state: "idle",
    focusEditable: null,
    ...extra,
  });
  emitTrayStatus("idle");
}

/**
 * Handle Scribe API errors according to the error handling matrix.
 * Returns true if the error was handled and the session should be terminated.
 */
function handleScribeError(
  error: ScribeError,
  set: (partial: Partial<TranscriptionStore>) => void,
  get: () => TranscriptionStoreState
): boolean {
  const { state: currentState } = get();
  console.error("[Transcription] Scribe error:", error.message_type, error.message);
  set({ lastError: error });

  switch (error.message_type) {
    // Fatal: stop immediately
    case "scribe_auth_error":
      cleanup(set);
      return true;

    case "scribe_quota_exceeded_error":
      cleanup(set);
      return true;

    // Recoverable: notify but continue
    case "scribe_throttled_error":
    case "scribe_rate_limited_error":
      // Continue recording — errors are transient
      return false;

    // Adjust: reduce send interval
    case "scribe_chunk_size_exceeded_error":
      // Could reduce interval, for now just log
      return false;

    // User guidance: notify user
    case "scribe_insufficient_audio_activity_error":
      // Low audio — continue, user may speak soon
      return false;

    // Reconnect: try once
    case "scribe_queue_overflow_error":
    case "scribe_resource_exhausted_error":
    case "scribe_session_time_limit_exceeded_error":
      if (!reconnectAttempted && (currentState === "recording" || currentState === "finalizing")) {
        reconnectAttempted = true;
        console.log("[Transcription] Attempting reconnect...");
        scribeClient?.disconnect();
        scribeClient = null;

        // Reconnect after short delay
        const apiKey = useConfigStore.getState().apiKey;
        if (apiKey) {
          setTimeout(() => {
            const { state: s } = get();
            if (s === "recording" || s === "finalizing") {
              connectScribe(apiKey, set, get);
            }
          }, RECONNECT_DELAY_MS);
        }
        return false;
      }
      // Second failure → clipboard fallback with what we have
      if (currentOutputText) {
        clipboardFallback(currentOutputText);
      }
      cleanup(set);
      return true;

    // Degraded: clipboard fallback
    case "scribe_transcriber_error":
      if (currentOutputText) {
        clipboardFallback(currentOutputText);
      }
      cleanup(set);
      return true;

    case "scribe_input_error":
      cleanup(set);
      return true;

    // Generic error: try to continue, fail on second occurrence
    case "scribe_error":
    default:
      return false;
  }
}

/** Create and connect a ScribeClient with all callbacks wired. */
function connectScribe(
  apiKey: string,
  set: (partial: Partial<TranscriptionStore>) => void,
  get: () => TranscriptionStoreState
): void {
  scribeClient = new ScribeClient();

  scribeClient.connect(apiKey, {
    onSessionStarted: (_sessionId) => {
      const { state: s } = get();
      if (s !== "waiting_session" && s !== "initializing" && s !== "recording") return;

      reconnectAttempted = false;
      set({ state: "recording" });
      emitTrayStatus("recording");

      // Start audio capture if not already running
      startAudioCapture((chunk) => {
        if (scribeClient?.isConnected()) {
          scribeClient.sendAudio(chunk.base64, previousTextContext);
          // Only send previous_text on first chunk
          previousTextContext = "";
        }
      }).catch((err) => {
        console.error("[Transcription] Audio capture failed:", err);
        cleanup(set, {
          lastError: {
            message_type: "scribe_error",
            message: `Audio capture failed: ${err}`,
          },
        });
      });
    },

    onPartialTranscript: (text: string) => {
      set({ partialText: text });

      throttledDiff(currentOutputText, text, (diff) => {
        injectDiff(diff);
      });
    },

    onCommittedTranscript: (text: string) => {
      set({ committedText: text, state: "idle" });
      emitTrayStatus("idle");
      currentOutputText = text;

      // If focus is not editable, use clipboard fallback
      if (!currentFocusEditable && text) {
        clipboardFallback(text);
      } else {
        // Flush and inject final diff
        flushPendingDiff((diff) => {
          injectDiff(diff);
        });
      }

      console.log("[Transcription] Final text:", text);
      scribeClient?.disconnect();
      scribeClient = null;
    },

    onError: (error: ScribeError) => {
      const shouldTerminate = handleScribeError(error, set, get);
      if (shouldTerminate) {
        stopAudioCapture().catch(() => {});
      }
    },

    onDisconnected: () => {
      const { state: s } = get();
      if (s === "waiting_session" || s === "initializing") {
        console.error("[Transcription] Disconnected before session start");
        cleanup(set, {
          lastError: {
            message_type: "scribe_error",
            message: "Connection failed",
          },
        });
      }
    },
  });
}

export const useTranscriptionStore = create<TranscriptionStore>(
  (set, get) => ({
    state: "idle",
    lastError: null,
    partialText: "",
    committedText: "",
    focusEditable: null,

    handleShortcutPressed: async () => {
      const { state: currentState } = get();
      if (currentState !== "idle") return;

      const { apiKey } = useConfigStore.getState();
      if (!apiKey) {
        console.warn("[Transcription] No API key configured");
        set({
          lastError: {
            message_type: "scribe_auth_error",
            message: "API key not configured",
          },
        });
        return;
      }

      set({
        state: "initializing",
        lastError: null,
        partialText: "",
        committedText: "",
        focusEditable: null,
      });
      emitTrayStatus("initializing");
      currentOutputText = "";
      previousTextContext = "";
      reconnectAttempted = false;

      // Check focus before connecting
      try {
        const focusResult = await checkFocus();
        currentFocusEditable = isEditable(focusResult);
        set({ focusEditable: currentFocusEditable });

        if (isEditable(focusResult)) {
          previousTextContext = focusResult.previousText;
        }

        console.log(
          "[Transcription] Focus check:",
          currentFocusEditable ? "editable" : "not editable"
        );
      } catch (err) {
        console.warn("[Transcription] Focus check failed:", err);
        currentFocusEditable = false;
        set({ focusEditable: false });
      }

      // Connect to ElevenLabs Scribe API
      connectScribe(apiKey, set, get);

      set({ state: "waiting_session" });
      emitTrayStatus("waiting_session");

      // Timeout: if no session starts within 5s, abort
      setTimeout(() => {
        const { state: s } = get();
        if (s === "waiting_session") {
          console.warn("[Transcription] Session start timeout");
          cleanup(set, {
            lastError: {
              message_type: "scribe_error",
              message: "Connection timeout",
            },
          });
        }
      }, 5000);
    },

    handleShortcutReleased: async () => {
      const { state: currentState } = get();
      if (currentState !== "recording") return;

      set({ state: "finalizing" });
      emitTrayStatus("finalizing");

      // Stop audio capture
      try {
        await stopAudioCapture();
      } catch (err) {
        console.error("[Transcription] Failed to stop audio capture:", err);
      }

      // Send commit signal to get final transcript
      scribeClient?.commit();

      // Timeout: if no committed_transcript within 3s, clean up
      setTimeout(() => {
        const { state: s, partialText: partial } = get();
        if (s === "finalizing") {
          console.warn("[Transcription] Finalization timeout");
          // If we have partial text, clipboard fallback
          if (partial && !currentFocusEditable) {
            clipboardFallback(partial);
          }
          cleanup(set);
        }
      }, 3000);
    },

    reset: () => {
      cleanup(set, {
        lastError: null,
        partialText: "",
        committedText: "",
      });
    },
  })
);
