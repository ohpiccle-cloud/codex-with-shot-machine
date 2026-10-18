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

test('200ms에 1bar 하강 시 자동 완료, 마지막 점과 피크 및 최종 시간 유지', () => {
  const s = new ExtractionSession();
  s.ingest(9, 1000);
  s.ingest(8, 1200);
  assert.equal(s.state, 'completed');
  assert.equal(s.completionReason, 'pressure-drop');
  assert.equal(s.peakPressure, 9);
  assert.equal(s.elapsed(9000), 0.2);
  assert.deepEqual(s.points.at(-1), { time: 0.2, pressure: 8 });
  s.ingest(7, 1400);
  assert.equal(s.points.length, 2);
  s.ingest(1, 1600);
  s.ingest(2, 1800);
  assert.equal(s.state, 'recording');
  assert.equal(s.completionReason, null);
});

test('완만한 하강과 상승은 추출을 종료하지 않음', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8.01, 200);
  assert.equal(s.state, 'recording');
  s.ingest(10, 400);
  assert.equal(s.state, 'recording');
  s.ingest(8.5, 700); // 1.5 bar / 0.3 s = 5 bar/s
  assert.equal(s.state, 'completed');
});

test('수신 공백과 동일 시각에 몰린 데이터는 즉시 급락으로 판정하지 않음', () => {
  const s = new ExtractionSession();
  s.ingest(12, 0);
  s.ingest(1, 1500);
  assert.equal(s.state, 'recording');
  s.ingest(9, 1700);
  s.ingest(8, 1700);
  assert.equal(s.state, 'recording');
});

test('무압 수동 시작 후 압력이 내려가면 자동 완료 가능', () => {
  const s = new ExtractionSession();
  s.ingest(0, 0);
  s.start(100);
  s.ingest(9, 300);
  s.ingest(7.9, 500);
  assert.equal(s.completionReason, 'pressure-drop');
  assert.equal(s.elapsed(2000), 0.4);
});
