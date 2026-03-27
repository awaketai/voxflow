// ── ElevenLabs Scribe API Types ──

export type ScribeErrorType =
  | "scribe_error"
  | "scribe_auth_error"
  | "scribe_quota_exceeded_error"
  | "scribe_throttled_error"
  | "scribe_rate_limited_error"
  | "scribe_queue_overflow_error"
  | "scribe_resource_exhausted_error"
  | "scribe_session_time_limit_exceeded_error"
  | "scribe_input_error"
  | "scribe_chunk_size_exceeded_error"
  | "scribe_insufficient_audio_activity_error"
  | "scribe_transcriber_error";

export interface ScribeError {
  message_type: ScribeErrorType;
  message?: string;
}

export interface ScribeClientCallbacks {
  onSessionStarted: (sessionId: string) => void;
  onPartialTranscript: (text: string) => void;
  onCommittedTranscript: (text: string) => void;
  onError: (error: ScribeError) => void;
  onDisconnected: () => void;
}

// ── Transcription State Machine ──

export type TranscriptionState =
  | "idle"
  | "initializing"
  | "waiting_session"
  | "recording"
  | "finalizing";

// ── Audio ──

export interface AudioChunk {
  base64: string;
  durationMs: number;
}

// ── Diff Engine ──

export interface DiffResult {
  backspaces: number;
  newText: string;
}
