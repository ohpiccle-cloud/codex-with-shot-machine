import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionSession, PressureLines } from './session.mjs';

function settlePressure(session, start) {
  for (let offset = 0; offset <= 1000; offset += 200) session.ingest(1.0, start + offset);
}

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
  settlePressure(s, 34000);
  s.ingest(1.2, 35200);
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
  s.start(32000);
  assert.equal(s.points.length, 1);
  assert.equal(s.elapsed(32500), 0.5);
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
  s.ingest(8, 3000);
  s.finish(4000);
  s.ingest(12, 5000);
  assert.equal(s.peakPressure, 9.45);
  assert.equal(s.elapsed(9000), 3);
  assert.ok(s.startedDate instanceof Date);
  settlePressure(s, 36000);
  s.ingest(1.2, 37200);
  assert.equal(s.peakPressure, 1.2);
  assert.equal(s.elapsed(37200), 0);
});

test('200ms에 0.4bar 하강 시 자동 완료, 마지막 점과 피크 및 최종 시간 유지', () => {
  const s = new ExtractionSession();
  s.ingest(9, 1000);
  s.ingest(8.6, 1200);
  assert.equal(s.state, 'completed');
  assert.equal(s.completionReason, 'pressure-drop');
  assert.equal(s.peakPressure, 9);
  assert.equal(s.elapsed(9000), 0.2);
  assert.deepEqual(s.points.at(-1), { time: 0.2, pressure: 8.6 });
  s.ingest(7, 1400);
  assert.equal(s.points.length, 2);
  s.ingest(1, 1600);
  s.ingest(2, 1800);
  assert.equal(s.state, 'completed');
  settlePressure(s, 32000);
  s.ingest(2, 33200);
  assert.equal(s.state, 'recording');
  assert.equal(s.completionReason, null);
});

test('완만한 하강과 상승은 추출을 종료하지 않음', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8.61, 200);
  assert.equal(s.state, 'recording');
  s.ingest(10, 400);
  assert.equal(s.state, 'recording');
  s.ingest(9, 900); // 1 bar / 0.5 s = 2 bar/s
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

test('완료 후 잔압 하강과 1bar 부근 반등은 그래프·시간·피크를 초기화하지 않음', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8, 200);
  const points = s.points.slice();
  const startedDate = s.startedDate;
  for (const [index, pressure] of [6, 3, 1.1, 0.99, 1.03, 0.8, 0.05, 0.2, 1.02].entries()) {
    s.ingest(pressure, 400 + index * 200);
    assert.equal(s.state, 'completed');
    assert.deepEqual(s.points, points);
    assert.equal(s.elapsed(9999), 0.2);
    assert.equal(s.peakPressure, 9);
    assert.equal(s.startedDate, startedDate);
  }
  settlePressure(s, 32400);
  s.ingest(1, 33600);
  assert.equal(s.state, 'completed');
  s.ingest(1.01, 33800);
  assert.equal(s.state, 'recording');
  assert.deepEqual(s.points, [{ time: 0, pressure: 1.01 }]);
});

test('저압 1초 미만, 압력 반등, 수신 공백은 자동 재시작을 허용하지 않음', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8, 200);
  s.ingest(0.05, 30400);
  s.ingest(0.05, 31200);
  s.ingest(1.2, 31400);
  assert.equal(s.state, 'completed');
  s.ingest(0.05, 31600);
  s.ingest(1.2, 32000);
  s.ingest(0.05, 32200);
  s.ingest(0.05, 32800);
  s.ingest(1.2, 33000);
  assert.equal(s.state, 'completed');
  s.ingest(0.05, 33200);
  s.ingest(0.05, 35000);
  s.ingest(1.2, 35200);
  assert.equal(s.state, 'completed');
});

test('30초 경과 후 잔압이 남아 있어도 수동 시작할 수 있음', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8, 200);
  s.start(30200);
  assert.equal(s.state, 'recording');
  assert.equal(s.completionReason, null);
  assert.deepEqual(s.points, [{ time: 0, pressure: 8 }]);
});

test('완료 후 30초 미만에는 자동·수동 시작을 모두 막고 그래프를 유지', () => {
  for (const automatic of [true, false]) {
    const s = new ExtractionSession();
    s.ingest(9, 0);
    if (automatic) s.ingest(8, 200);
    else s.finish(200);
    const points = s.points.slice();
    assert.equal(s.cooldownRemainingMs(200), 30000);
    settlePressure(s, 400);
    s.ingest(2, 1600);
    for (const now of [1600, 15000, 30199]) {
      s.start(now);
      assert.equal(s.state, 'completed');
      assert.deepEqual(s.points, points);
      assert.equal(s.elapsed(now), 0.2);
    }
    assert.equal(s.cooldownRemainingMs(30199), 1);
    assert.equal(s.cooldownRemainingMs(30200), 0);
    s.start(30200);
    assert.equal(s.state, 'recording');
  }
});

test('30초 만료만으로 자동 시작하지 않고 이후 저압 안정과 새 상승을 기다림', () => {
  const s = new ExtractionSession();
  s.ingest(9, 0);
  s.ingest(8, 200);
  settlePressure(s, 28000);
  s.ingest(2, 30000);
  s.ingest(2, 30200);
  assert.equal(s.state, 'completed');
  settlePressure(s, 30400);
  s.ingest(1.01, 31600);
  assert.equal(s.state, 'recording');
});
