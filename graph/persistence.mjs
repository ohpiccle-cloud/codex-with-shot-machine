import { ExtractionSession } from './session.mjs?v=2026-11-04-r2';

const KEY = 'shot-completed-record-v1';

export function restoreCompleted(storage, now, wallNow) {
  const fallback = { session: new ExtractionSession(), notes: '' };
  try {
    const record = JSON.parse(storage.getItem(KEY));
    if (!record || record.version !== 1 || !Number.isFinite(record.endedWallAt)
        || !Number.isFinite(record.durationMs) || record.durationMs < 0
        || !Number.isFinite(record.peakPressure) || !Array.isArray(record.points)
        || record.points.some(p => !Number.isFinite(p.time) || p.time < 0 || !Number.isFinite(p.pressure) || p.pressure < 0)
        || !Number.isFinite(Date.parse(record.startedDate))) return fallback;
    const session = new ExtractionSession();
    session.state = 'completed';
    session.endedAt = now - Math.max(0, wallNow - record.endedWallAt);
    session.startedAt = session.endedAt - record.durationMs;
    session.startedDate = new Date(record.startedDate);
    session.points = record.points;
    session.peakPressure = record.peakPressure;
    session.completionReason = record.completionReason;
    session.armed = false;
    return { session, notes: typeof record.notes === 'string' ? record.notes : '' };
  } catch {
    return fallback;
  }
}

export function persistCompleted(storage, session, now, wallNow, notes) {
  if (session.state !== 'completed') {
    storage.removeItem(KEY);
    return;
  }
  storage.setItem(KEY, JSON.stringify({
    version: 1,
    endedWallAt: wallNow - (now - session.endedAt),
    durationMs: session.endedAt - session.startedAt,
    startedDate: session.startedDate.toISOString(),
    points: session.points,
    peakPressure: session.peakPressure,
    completionReason: session.completionReason,
    notes,
  }));
}
