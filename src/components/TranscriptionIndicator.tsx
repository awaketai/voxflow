import { useTranscriptionStore } from "../stores/transcription-store";
import type { TranscriptionState } from "../types";

const STATE_CONFIG: Record<
  TranscriptionState,
  { label: string; dotClass: string }
> = {
  idle: { label: "Ready", dotClass: "bg-muted-foreground" },
  initializing: { label: "Connecting...", dotClass: "bg-yellow-500 animate-pulse" },
  waiting_session: { label: "Waiting...", dotClass: "bg-yellow-500 animate-pulse" },
  recording: { label: "Recording", dotClass: "bg-red-500 animate-pulse" },
  finalizing: { label: "Finalizing...", dotClass: "bg-blue-500 animate-pulse" },
};

export function TranscriptionIndicator() {
  const { state, lastError, partialText, committedText } =
    useTranscriptionStore();

  const config = STATE_CONFIG[state];

  return (
    <div className="space-y-3">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
        <span className="text-xs text-muted-foreground">{config.label}</span>
      </div>

      {/* Live transcript preview */}
      {state === "recording" && partialText && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-foreground break-words">{partialText}</p>
        </div>
      )}

      {/* Committed text */}
      {committedText && state !== "recording" && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">Result:</p>
          <p className="text-xs text-foreground break-words">{committedText}</p>
        </div>
      )}

      {/* Error */}
      {lastError && (
        <div className="rounded-md bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive break-words">
            {lastError.message ?? lastError.message_type}
          </p>
        </div>
      )}
    </div>
  );
}
