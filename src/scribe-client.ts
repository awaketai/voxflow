import type {
  ScribeClientCallbacks,
  ScribeError,
  ScribeErrorType,
} from "./types";

const SCRIBE_WS_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual";

const SCRIBE_ERROR_TYPES = new Set<string>([
  "scribe_error",
  "scribe_auth_error",
  "scribe_quota_exceeded_error",
  "scribe_throttled_error",
  "scribe_rate_limited_error",
  "scribe_queue_overflow_error",
  "scribe_resource_exhausted_error",
  "scribe_session_time_limit_exceeded_error",
  "scribe_input_error",
  "scribe_chunk_size_exceeded_error",
  "scribe_insufficient_audio_activity_error",
  "scribe_transcriber_error",
]);

export class ScribeClient {
  private ws: WebSocket | null = null;
  private callbacks: ScribeClientCallbacks | null = null;
  private isFirstChunk = true;
  private pendingPreviousText: string | undefined;

  connect(apiKey: string, callbacks: ScribeClientCallbacks): void {
    this.disconnect();
    this.callbacks = callbacks;
    this.isFirstChunk = true;

    // ElevenLabs expects xi-api-key as query param for browser WebSocket
    const url = `${SCRIBE_WS_URL}&xi-api-key=${encodeURIComponent(apiKey)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[ScribeClient] WebSocket connected");
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = () => {
      this.callbacks?.onError({
        message_type: "scribe_error",
        message: "WebSocket connection error",
      });
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.log("[ScribeClient] WebSocket closed:", event.code, event.reason);
      this.callbacks?.onDisconnected();
    };
  }

  sendAudio(base64Chunk: string, previousText?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ScribeClient] Cannot send audio: not connected");
      return;
    }

    const message: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: base64Chunk,
      commit: false,
      sample_rate: 16000,
    };

    // Attach previous_text on the first chunk for context
    if (this.isFirstChunk) {
      this.isFirstChunk = false;
      if (previousText) {
        message.previous_text = previousText.slice(0, 50);
      }
    }

    this.ws.send(JSON.stringify(message));
  }

  commit(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ScribeClient] Cannot commit: not connected");
      return;
    }

    const message = {
      message_type: "input_audio_chunk",
      audio_base_64: "",
      commit: true,
    };

    this.ws.send(JSON.stringify(message));
    console.log("[ScribeClient] Sent commit signal");
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null; // Prevent onDisconnected callback on intentional close
      this.ws.close();
      this.ws = null;
    }
    this.callbacks = null;
    this.isFirstChunk = true;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: string): void {
    if (!this.callbacks) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn("[ScribeClient] Failed to parse message:", data);
      return;
    }

    const messageType = parsed.message_type as string;

    switch (messageType) {
      case "session_started": {
        const sessionId =
          (parsed.session_id as string) ?? "unknown";
        console.log("[ScribeClient] Session started:", sessionId);
        this.callbacks.onSessionStarted(sessionId);
        break;
      }

      case "partial_transcript": {
        const text = (parsed.text as string) ?? "";
        this.callbacks.onPartialTranscript(text);
        break;
      }

      case "committed_transcript": {
        const text = (parsed.text as string) ?? "";
        console.log("[ScribeClient] Committed transcript:", text);
        this.callbacks.onCommittedTranscript(text);
        break;
      }

      default: {
        if (SCRIBE_ERROR_TYPES.has(messageType)) {
          const error: ScribeError = {
            message_type: messageType as ScribeErrorType,
            message: (parsed.message as string) ?? undefined,
          };
          console.error("[ScribeClient] Error:", messageType, error.message);
          this.callbacks.onError(error);
        } else {
          console.log("[ScribeClient] Unknown message type:", messageType, parsed);
        }
        break;
      }
    }
  }
}
