export const AUTO_START_BAR = 1.0;
export const AUTO_FINISH_DROP_BAR_PER_SECOND = 2.0;

export class ExtractionSession {
  constructor() {
    this.state = 'waiting';
    this.pressure = null;
    this.points = [];
    this.startedAt = null;
    this.endedAt = null;
    this.armed = true;
    this.peakPressure = null;
    this.startedDate = null;
    this.completionReason = null;
    this.slopeSample = null;
  }

  start(now) {
    if (this.state === 'recording') return;
    this.state = 'recording';
    this.startedAt = now;
    this.startedDate = new Date();
    this.peakPressure = this.pressure;
    this.endedAt = null;
    this.points = [];
    this.armed = false;
    this.completionReason = null;
    this.slopeSample = this.pressure === null ? null : { pressure: this.pressure, at: now };
    if (this.pressure !== null) this.points.push({ time: 0, pressure: this.pressure });
  }

  finish(now, reason = 'manual') {
    if (this.state !== 'recording') return;
    this.endedAt = now;
    this.state = 'completed';
    this.completionReason = reason;
    this.armed = this.pressure !== null && this.pressure <= AUTO_START_BAR;
  }

  ingest(pressure, now) {
    if (!Number.isFinite(pressure) || pressure < 0) return;
    this.pressure = pressure;
    if (this.state !== 'recording') {
      if (pressure <= AUTO_START_BAR) this.armed = true;
      if (pressure > AUTO_START_BAR && this.armed) {
        this.start(now);
        return;
      }
    }
    if (this.state === 'recording') {
      this.points.push({ time: this.elapsed(now), pressure });
      this.peakPressure = Math.max(this.peakPressure ?? pressure, pressure);
      const previous = this.slopeSample;
      const interval = previous === null ? null : now - previous.at;
      // Ignore near-simultaneous buffered lines and gaps in reception.
      // At the normal 5 Hz rate, a 0.4 bar drop over 200 ms completes a shot.
      if (previous && interval >= 100 && interval <= 1000
          && (previous.pressure - pressure) * 1000 >= AUTO_FINISH_DROP_BAR_PER_SECOND * interval) {
        this.finish(now, 'pressure-drop');
      }
      if (previous === null || interval >= 100 || interval < 0) {
        this.slopeSample = { pressure, at: now };
      }
    }
  }

  elapsed(now) {
    return this.startedAt === null ? 0 : ((this.endedAt ?? now) - this.startedAt) / 1000;
  }
}

// USB 읽기는 한 줄을 여러 조각으로 나누거나 여러 줄을 한 번에 반환할 수 있다.
export class PressureLines {
  constructor(onPressure) {
    this.buffer = '';
    this.onPressure = onPressure;
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    if (this.buffer.length > 128) this.buffer = '';
    for (const line of lines) {
      const value = line.trim();
      if (!/^\d+(\.\d+)?$/.test(value)) continue;
      const pressure = Number(value);
      if (Number.isFinite(pressure)) this.onPressure(pressure);
    }
  }
}
