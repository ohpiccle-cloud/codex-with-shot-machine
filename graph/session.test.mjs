import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionSession, PressureLines } from './session.mjs';

test('1bar 초과 자동 시작, 상대 시간 기록, 수동 완료 후 고압 재시작 방지', () => {
  const s = new ExtractionSession();
  s.ingest(0.5, 50);
  assert.equal(s.state, 'waiting');
  s.ingest(1.0, 100);
  assert.equal(s.state, 'waiting');
  s.ingest(1.01, 200);
  assert.equal(s.state, 'recording');
  s.ingest(9, 1200);
  assert.deepEqual(s.points, [{ time: 0, pressure: 1.01 }, { time: 1, pressure: 9 }]);
  s.finish(2200);
  s.ingest(8, 3000);
  assert.equal(s.state, 'completed');
  assert.equal(s.elapsed(9000), 2);
  assert.equal(s.points.length, 2);
  s.ingest(1.0, 4000);
  s.ingest(1.2, 5000);
  assert.equal(s.state, 'recording');
  assert.deepEqual(s.points, [{ time: 0, pressure: 1.2 }]);
});

test('무압 수동 시작, 완료 및 다음 수동 시작', () => {
  const s = new ExtractionSession();
  s.ingest(0, 0);
  s.start(1000);
  s.ingest(0, 1500);
  assert.equal(s.state, 'recording');
  assert.equal(s.points[1].time, 0.5);
  s.finish(2000);
  assert.equal(s.state, 'completed');
  s.start(3000);
  assert.equal(s.points.length, 1);
  assert.equal(s.elapsed(3500), 0.5);
});

test('분할·복수 시리얼 줄 처리 및 잘못된 값 무시', () => {
  const values = [];
  const lines = new PressureLines(value => values.push(value));
  lines.push('0.');
  lines.push('10\r\n9.20\nStarting...\n-1\nNaN\n1,2,3\n\n2');
  lines.push('.34\n');
  assert.deepEqual(values, [0.1, 9.2, 2.34]);
});

test('잘못된 측정값은 자동 시작이나 기록을 유발하지 않음', () => {
  const s = new ExtractionSession();
  for (const p of [NaN, Infinity, -1]) s.ingest(p, 0);
  assert.equal(s.state, 'waiting');
  assert.equal(s.pressure, null);
});

test('완료 후 피크와 최종 시간을 유지하고 새 추출에서 초기화', () => {
  const s = new ExtractionSession();
  s.ingest(1.01, 1000);
  s.ingest(9.45, 2000);
  s.ingest(6, 3000);
  s.finish(4000);
  s.ingest(12, 5000);
  assert.equal(s.peakPressure, 9.45);
  assert.equal(s.elapsed(9000), 3);
  assert.ok(s.startedDate instanceof Date);
  s.ingest(0, 6000);
  s.ingest(1.2, 7000);
  assert.equal(s.peakPressure, 1.2);
  assert.equal(s.elapsed(7000), 0);
});
