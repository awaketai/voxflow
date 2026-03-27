import type { DiffResult } from "./types";

/**
 * Compute the diff between current text and new text.
 * Returns the number of backspaces needed and the new text to append.
 *
 * Uses longest common prefix (LCP) to determine the edit boundary.
 * Operates on Unicode code points (not bytes) for correct multi-byte handling.
 */
export function computeDiff(currentText: string, newText: string): DiffResult {
  const currentChars = Array.from(currentText);
  const newChars = Array.from(newText);

  let lcpLength = 0;
  const minLen = Math.min(currentChars.length, newChars.length);
  while (lcpLength < minLen && currentChars[lcpLength] === newChars[lcpLength]) {
    lcpLength++;
  }

  return {
    backspaces: currentChars.length - lcpLength,
    newText: newChars.slice(lcpLength).join(""),
  };
}

/**
 * Create a throttled version of a transcript handler.
 * Only invokes the callback if the minimum interval has elapsed since the last call.
 */
export function createThrottledDiffHandler(
  callback: (diff: DiffResult) => void,
  intervalMs: number = 50
): (currentText: string, newText: string) => void {
  let lastCallTime = 0;
  let lastCurrentText = "";
  let lastNewText = "";

  return (currentText: string, newText: string) => {
    lastCurrentText = currentText;
    lastNewText = newText;

    const now = Date.now();
    if (now - lastCallTime < intervalMs) {
      return;
    }

    lastCallTime = now;

    const diff = computeDiff(currentText, newText);
    if (diff.backspaces === 0 && diff.newText === "") {
      return; // Skip no-op diffs
    }

    callback(diff);
  };
}

/**
 * Flush any pending throttled diff.
 * Call this when transcription ends to ensure the final text is processed.
 */
export function flushThrottledDiff(
  currentText: string,
  newText: string,
  callback: (diff: DiffResult) => void
): void {
  if (currentText === newText) return;

  const diff = computeDiff(currentText, newText);
  if (diff.backspaces > 0 || diff.newText.length > 0) {
    callback(diff);
  }
}
