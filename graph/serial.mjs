import { PressureLines } from './session.mjs';

// Web Serial recreates readable after recoverable framing/overrun errors.
// Reacquire the reader without reopening the port (which may reset the board).
export async function receivePressure(port, { onPressure, onReader, onReadError, shouldStop }) {
  let failures = 0;
  while (!shouldStop() && port.readable) {
    const reader = port.readable.getReader();
    onReader(reader);
    const decoder = new TextDecoder();
    const lines = new PressureLines(pressure => {
      failures = 0;
      onPressure(pressure);
    });
    let retry = false;
    try {
      while (!shouldStop()) {
        const { value, done } = await reader.read();
        if (done) return;
        lines.push(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (shouldStop()) return;
      if (!port.readable || ++failures > 3) throw error;
      onReadError(error, failures);
      retry = true;
    } finally {
      reader.releaseLock();
      onReader(null);
    }
    if (retry) await new Promise(resolve => setTimeout(resolve, 250));
  }
}
