import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionSession } from './session.mjs';
import { persistCompleted, restoreCompleted } from './persistence.mjs';
const storage = () => {
  let value = null;
  return { getItem: () => value, setItem: (_, v) => { value = v; }, removeItem: () => { value = null; } };
};

test('새로고침 후 완료 그래프·피크·최종 시간과 남은 30초 잠금 유지', () => {
  const saved = storage(), s = new ExtractionSession();
  s.ingest(9, 0); s.ingest(8, 200);
  persistCompleted(saved, s, 400, 1000000, '도징량 18g');
  const { session: restored, notes } = restoreCompleted(saved, 50, 1005000);
  assert.equal(restored.cooldownRemainingMs(50), 24800);
  restored.start(100);
  restored.ingest(9, 200);
  assert.equal(restored.state, 'completed');
  assert.deepEqual(restored.points, s.points);
  assert.equal(restored.peakPressure, 9);
  assert.equal(restored.elapsed(200), 0.2);
  assert.equal(notes, '도징량 18g');
});

test('30초가 지난 뒤 복원해도 잔압으로 즉시 자동 시작하지 않음', () => {
  const saved = storage(), s = new ExtractionSession();
  s.ingest(9, 0); s.ingest(8, 200);
  persistCompleted(saved, s, 200, 1000000, '');
  const { session: restored } = restoreCompleted(saved, 0, 1040000);
  restored.ingest(8, 0);
  assert.equal(restored.state, 'completed');
  restored.start(1);
  persistCompleted(saved, restored, 1, 1040001, '');
  assert.equal(restoreCompleted(saved, 0, 1041000).session.state, 'waiting');
});

test('저장값 없음·잘못된 값·저장소 오류는 첫 실행을 막지 않음', () => {
  assert.equal(restoreCompleted(storage(), 0, 0).session.state, 'waiting');
  assert.equal(restoreCompleted({ getItem: () => '{broken' }, 0, 0).session.state, 'waiting');
  assert.equal(restoreCompleted({ getItem: () => { throw new Error('blocked'); } }, 0, 0).session.state, 'waiting');
});
