import { ExtractionSession, PressureLines } from './session.mjs';

const session = new ExtractionSession();
const $ = id => document.getElementById(id);
const canvas = $('graph');
const ctx = canvas.getContext('2d');
let port = null;
let reader = null;
let connected = false;
let closing = false;
let lastDataAt = null;
let busy = false;

function refresh() {
  $('pressure').textContent = session.pressure === null ? '—' : session.pressure.toFixed(2);
  $('elapsed').textContent = session.elapsed(performance.now()).toFixed(1);
  $('state').textContent = { waiting: '대기 중', recording: '추출 중', completed: '추출 완료' }[session.state];
  $('state').style.color = session.state === 'recording' ? '#74d6bf' : '';
  $('toggle').textContent = session.state === 'recording' ? '추출 완료 (Space)' : '추출 시작 (Space)';
  const stale = lastDataAt === null || performance.now() - lastDataAt > 2000;
  $('toggle').disabled = !connected || (stale && session.state !== 'recording');
  $('download').disabled = session.points.length === 0;
  if (connected && !closing) {
    $('connection').textContent = stale ? '연결됨 · 압력 데이터 대기 중. 2초 이상 지속되면 스케치와 시리얼 속도(115200)를 확인하세요.' : '연결됨 · 압력 데이터 수신 중 (115200 baud)';
  }
  draw();
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#192331';
  ctx.fillRect(0, 0, width, height);
  const left = 58, top = 22, right = width - 20, bottom = height - 52;
  const duration = session.elapsed(performance.now());
  const maxTime = Math.max(60, Math.ceil(duration / 10) * 10);
  const maxPressure = 20;
  const x = t => left + t / maxTime * (right - left);
  const y = p => bottom - p / maxPressure * (bottom - top);
  ctx.font = '12px system-ui';
  for (let i = 0; i <= 6; i++) {
    const t = maxTime * i / 6;
    ctx.strokeStyle = '#2b394b';
    ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), bottom); ctx.stroke();
    ctx.fillStyle = '#a6b6c9';
    ctx.textAlign = 'center'; ctx.fillText(t.toFixed(0), x(t), bottom + 22);
  }
  for (let p = 0; p <= maxPressure; p += 5) {
    ctx.strokeStyle = '#2b394b';
    ctx.beginPath(); ctx.moveTo(left, y(p)); ctx.lineTo(right, y(p)); ctx.stroke();
    ctx.fillStyle = '#a6b6c9'; ctx.textAlign = 'right';
    ctx.fillText(p.toFixed(0), left - 10, y(p) + 4);
  }
  ctx.fillStyle = '#a6b6c9'; ctx.textAlign = 'center';
  ctx.fillText('추출 시간 (초)', (left + right) / 2, height - 6);
  ctx.save(); ctx.translate(14, (top + bottom) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('추출 압력 (bar)', 0, 0); ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.strokeStyle = '#74d6bf'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  session.points.forEach((point, i) => {
    if (i === 0) ctx.moveTo(x(point.time), y(point.pressure));
    else ctx.lineTo(x(point.time), y(point.pressure));
  });
  ctx.stroke();
  if (session.points.length === 1) {
    const p = session.points[0]; ctx.fillStyle = '#74d6bf';
    ctx.beginPath(); ctx.arc(x(p.time), y(p.pressure), 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function toggleRecording() {
  if ($('toggle').disabled) return;
  if (session.state === 'recording') session.finish(performance.now());
  else session.start(performance.now());
  refresh();
}

$('toggle').addEventListener('click', toggleRecording);
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.target.closest('input, textarea, select, [contenteditable]')) return;
  event.preventDefault();
  if (!event.repeat) toggleRecording();
});

$('connect').addEventListener('click', async () => {
  if (closing || (busy && !connected)) return;
  if (connected) {
    closing = true;
    $('connect').disabled = true;
    try { await reader?.cancel(); }
    catch { /* 읽기 루프의 finally에서 연결 정리 */ }
    return;
  }
  busy = true;
  $('connect').disabled = true;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    connected = true;
    closing = false;
    session.pressure = null;
    lastDataAt = null;
    $('connect').textContent = '연결 해제';
    $('connect').disabled = false;
    const decoder = new TextDecoder();
    const lines = new PressureLines(pressure => {
      session.ingest(pressure, performance.now());
      lastDataAt = performance.now();
    });
    reader = port.readable.getReader();
    while (!closing) {
      const { value, done } = await reader.read();
      if (done) break;
      lines.push(decoder.decode(value, { stream: true }));
    }
    $('connection').textContent = '연결이 해제되었습니다. 다시 연결할 수 있습니다.';
  } catch (error) {
    $('connection').textContent = error.name === 'NotFoundError'
      ? '보드 선택이 취소되었습니다.'
      : `연결 실패: ${error.message}. Arduino IDE의 시리얼 모니터를 닫고 다시 연결하세요.`;
  } finally {
    connected = false;
    session.finish(performance.now());
    reader?.releaseLock();
    reader = null;
    if (port) { try { await port.close(); } catch { /* 이미 분리된 USB 장치 */ } }
    port = null;
    busy = false;
    closing = false;
    $('connect').disabled = false;
    $('connect').textContent = '아두이노 연결';
    refresh();
  }
});

$('download').addEventListener('click', () => {
  draw();
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `extraction-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});

if (!('serial' in navigator) || !window.isSecureContext) {
  $('connect').disabled = true;
  $('connection').textContent = 'PC용 Chrome 또는 Edge에서 localhost로 열어주세요. 이 브라우저에서는 USB 시리얼 연결을 지원하지 않습니다.';
}
setInterval(refresh, 100);
refresh();
