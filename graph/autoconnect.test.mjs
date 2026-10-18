import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAutomaticPort, portIdentity } from './autoconnect.mjs';
const port = (vendor, product) => ({ getInfo: () => ({ usbVendorId: vendor, usbProductId: product }) });

test('허용된 단일 포트 자동 선택 및 저장한 아두이노 우선 선택', () => {
  const uno = port(0x2341, 0x0043), other = port(10, 20);
  assert.equal(chooseAutomaticPort([uno], null), uno);
  assert.equal(chooseAutomaticPort([other, uno], portIdentity(uno)), uno);
});

test('권한 없음, 저장 장치 없음, 여러 장치 또는 동일 USB 장치는 수동 선택', () => {
  const uno = port(0x2341, 0x0043), twin = port(0x2341, 0x0043), other = port(10, 20);
  assert.equal(chooseAutomaticPort([], null), null);
  assert.equal(chooseAutomaticPort([other], portIdentity(uno)), null);
  assert.equal(chooseAutomaticPort([uno, other], null), null);
  assert.equal(chooseAutomaticPort([uno, twin], portIdentity(uno)), null);
});
