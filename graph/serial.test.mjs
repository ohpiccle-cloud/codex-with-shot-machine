import test from 'node:test';
import assert from 'node:assert/strict';
import { receivePressure } from './serial.mjs';

function source(read) {
  const state = { released: false };
  return { state, getReader: () => ({ read, releaseLock() { state.released = true; } }) };
}
const chunk = text => ({ value: new TextEncoder().encode(text), done: false });
const callbacks = () => ({ onPressure() {}, onReader() {}, onReadError() {}, shouldStop: () => false });

test('일시 오류 후 reader 재생성, 손상된 미완성 줄 폐기 및 수신 재개', async () => {
  const values = []; let index = 0, reads = 0, retries = 0;
  const first = source(async () => {
    if (reads++ === 0) return chunk('1.20\n9.');
    index = 1; throw new DOMException('overrun', 'BufferOverrunError');
  });
  const second = source(async () => reads++ === 2 ? chunk('2.30\n') : { done: true });
  const port = { get readable() { return [first, second][index]; } };
  await receivePressure(port, { ...callbacks(), onPressure: p => values.push(p), onReadError: () => retries++ });
  assert.deepEqual(values, [1.2, 2.3]);
  assert.equal(retries, 1);
  assert.ok(first.state.released && second.state.released);
});

test('USB 분리 오류는 자동 재연결 없이 종료하고 reader 해제', async () => {
  let stream;
  const failed = source(async () => { stream = null; throw new Error('USB disconnected'); });
  stream = failed;
  await assert.rejects(receivePressure({ get readable() { return stream; } }, callbacks()), /USB disconnected/);
  assert.equal(failed.state.released, true);
});

test('수신 없는 반복 오류는 3회만 재시도', async () => {
  let retries = 0, reads = 0;
  const stream = source(async () => { reads++; throw new Error('persistent'); });
  await assert.rejects(receivePressure({ readable: stream }, { ...callbacks(), onReadError: () => retries++ }), /persistent/);
  assert.equal(retries, 3); assert.equal(reads, 4);
});

test('사용자 연결 해제는 재시도하지 않음', async () => {
  let closing = false, retries = 0;
  const stream = source(async () => { closing = true; throw new Error('cancelled'); });
  await receivePressure({ readable: stream }, { ...callbacks(), shouldStop: () => closing, onReadError: () => retries++ });
  assert.equal(retries, 0); assert.equal(stream.state.released, true);
});
