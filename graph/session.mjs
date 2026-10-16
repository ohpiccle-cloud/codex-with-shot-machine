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
    if (this.pressure !== null) this.points.push({ time: 0, pressure: this.pressure });
  }

  finish(now) {
    if (this.state !== 'recording') return;
    this.endedAt = now;
    this.state = 'completed';
    this.armed = this.pressure !== null && this.pressure <= 0.1;
  }

  ingest(pressure, now) {
    if (!Number.isFinite(pressure) || pressure < 0) return;
    this.pressure = pressure;
    if (this.state !== 'recording') {
      if (pressure <= 0.1) this.armed = true;
      if (pressure > 0.1 && this.armed) {
        this.start(now);
        return;
      }
    }
    if (this.state === 'recording') {
      this.points.push({ time: this.elapsed(now), pressure });
      this.peakPressure = Math.max(this.peakPressure ?? pressure, pressure);
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
