import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";

export interface AudioChunk {
  base64: string;
  durationMs: number;
}

let currentChannel: Channel<AudioChunk> | null = null;

export async function startAudioCapture(
  onChunk: (chunk: AudioChunk) => void
): Promise<void> {
  if (currentChannel !== null) {
    console.warn("[AudioCapture] Already capturing");
    return;
  }

  const channel = new Channel<AudioChunk>();
  currentChannel = channel;

  channel.onmessage = (chunk: AudioChunk) => {
    console.log(
      `[AudioCapture] Received chunk: ${chunk.base64.length} bytes, duration: ${chunk.durationMs}ms`
    );
    onChunk(chunk);
  };

  await invoke("start_audio_capture", { onAudioChunk: channel });
  console.log("[AudioCapture] Started");
}

export async function stopAudioCapture(): Promise<void> {
  if (currentChannel === null) {
    console.warn("[AudioCapture] Not capturing");
    return;
  }

  await invoke("stop_audio_capture");
  currentChannel = null;
  console.log("[AudioCapture] Stopped");
}

export function isCapturing(): boolean {
  return currentChannel !== null;
}
