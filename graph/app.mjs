import { ExtractionSession } from './session.mjs';
import { receivePressure } from './serial.mjs';
import { chooseAutomaticPort, portIdentity } from './autoconnect.mjs';
import './window.mjs';

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
let saving = false;
let readWarning = '';
const stateColors = { waiting: '#94a3b8', recording: '#fbbf24', completed: '#74d6bf' };

function refresh() {
  const stale = lastDataAt === null || performance.now() - lastDataAt > 2000;
  $('pressure').textContent = !connected || stale || session.pressure === null ? '—' : session.pressure.toFixed(2);
  $('elapsed').textContent = session.elapsed(performance.now()).toFixed(1);
  $('state').textContent = { waiting: '추출 전', recording: '추출 중', completed: '추출 완료' }[session.state];
  if (session.completionReason === 'pressure-drop') $('state').textContent += ' (자동)';
  $('state').style.color = stateColors[session.state];
  $('chart-panel').dataset.state = session.state;
  $('toggle').textContent = session.state === 'recording' ? '추출 완료 (Space)' : '추출 시작 (Space)';
  $('toggle').disabled = !connected || (stale && session.state !== 'recording');
  $('download').disabled = saving || session.state !== 'completed' || session.points.length === 0;
  if (connected && !closing) {
    const delay = lastDataAt === null ? '압력 데이터 대기 중' : `압력 수신 중단 · 마지막 수신 ${Math.floor((performance.now() - lastDataAt) / 1000)}초 전`;
    $('connection').textContent = readWarning || (stale
      ? `연결됨 · ${delay}. 계속되면 기록을 저장하고 연결 해제 후 다시 연결하세요.`
      : '연결됨 · 압력 데이터 수신 중 (115200 baud)');
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
  ctx.strokeStyle = stateColors[session.state]; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.lineWidth = 1;
  const left = 58, top = 60, right = width - 20, bottom = height - 52;
  const duration = session.elapsed(performance.now());
  ctx.fillStyle = '#e6edf6'; ctx.textAlign = 'left'; ctx.font = 'bold 14px system-ui';
  const peak = session.peakPressure === null ? '—' : session.peakPressure.toFixed(2);
  ctx.fillText(`피크 압력: ${peak} bar`, left, 22);
  ctx.fillText(`${session.state === 'completed' ? '최종 시간' : '추출 시간'}: ${duration.toFixed(1)}초`, left, 44);
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
  if (session.peakPressure !== null && session.peakPressure <= maxPressure) {
    ctx.save();
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(left, y(session.peakPressure));
    ctx.lineTo(right, y(session.peakPressure)); ctx.stroke();
    ctx.restore();
  }
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
  if ($('history-preview').open || event.target.closest('.history')) return;
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
  await connectPort();
});

async function connectPort(knownPort = null) {
  if (busy || connected || closing) return;
  busy = true;
  $('connect').disabled = true;
  $('connection').textContent = knownPort ? '이전에 허용한 아두이노에 자동 연결 중…' : '아두이노 포트를 선택해주세요.';
  try {
    port = knownPort ?? await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    try { localStorage.setItem('shot-port-identity', portIdentity(port)); } catch { /* 저장소 사용 불가 */ }
    connected = true;
    closing = false;
    session.pressure = null;
    lastDataAt = null;
    readWarning = '';
    $('connect').textContent = '연결 해제';
    $('connect').disabled = false;
    await receivePressure(port, {
      onPressure: pressure => {
        session.ingest(pressure, performance.now());
        lastDataAt = performance.now();
        readWarning = '';
      },
      onReader: value => { reader = value; },
      onReadError: (error, attempt) => {
        readWarning = `시리얼 수신 오류 (${error.name}) · 수신 복구 시도 ${attempt}/3. 계속되면 기록을 저장하고 다시 연결하세요.`;
      },
      shouldStop: () => closing,
    });
    $('connection').textContent = '연결이 해제되었습니다. 다시 연결할 수 있습니다.';
  } catch (error) {
    $('connection').textContent = error.name === 'NotFoundError'
      ? '보드 선택이 취소되었습니다.'
      : `연결/수신 오류 (${error.name}): ${error.message}. USB 연결과 PC 절전 상태를 확인하고, 시리얼 모니터를 닫은 뒤 다시 연결하세요.`;
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
}

async function autoConnect() {
  if (busy || connected || closing) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (busy || connected || closing) return;
    let preferred = null;
    try { preferred = localStorage.getItem('shot-port-identity'); } catch { /* 저장소 사용 불가 */ }
    const candidate = chooseAutomaticPort(ports, preferred);
    if (candidate) {
      void connectPort(candidate);
    } else {
      $('connection').textContent = ports.length > 1
        ? '허용된 장치가 여러 개입니다. 아두이노 연결을 눌러 사용할 포트를 선택하세요.'
        : '자동 연결할 아두이노가 없습니다. USB 연결을 확인하고 처음 한 번 아두이노 연결을 눌러 허용해주세요.';
    }
  } catch (error) {
    if (!busy && !connected) $('connection').textContent = `자동 연결 확인 실패: ${error.message}. 아두이노 연결 버튼으로 연결하세요.`;
  }
}

function extractionDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createRecordImage() {
  draw();
  const record = document.createElement('canvas');
  record.width = 1200;
  const context = record.getContext('2d');
  context.font = '22px system-ui';
  const lines = [];
  const notes = $('notes').value.trim().replace(/\n{3,}/g, '\n\n') || '메모 없음';
  for (const paragraph of notes.split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (context.measureText(line + character).width > record.width - 80) {
        lines.push(line); line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  const graphHeight = Math.round(canvas.height / canvas.width * record.width);
  record.height = 100 + graphHeight + 80 + lines.length * 32;
  context.fillStyle = '#192331'; context.fillRect(0, 0, record.width, record.height);
  context.fillStyle = '#e6edf6'; context.font = 'bold 28px system-ui';
  context.fillText('추출 기록', 40, 42);
  context.font = '20px system-ui';
  context.fillText(`추출 시작: ${session.startedDate.toLocaleString('ko-KR', { hour12: false })}`, 40, 76);
  context.drawImage(canvas, 0, 100, record.width, graphHeight);
  context.font = 'bold 22px system-ui';
  context.fillText('추출 메모', 40, 100 + graphHeight + 38);
  context.font = '22px system-ui';
  lines.forEach((line, i) => context.fillText(line, 40, 100 + graphHeight + 76 + i * 32));
  return record;
}

$('download').addEventListener('click', async () => {
  if ($('download').disabled) return;
  saving = true;
  const date = extractionDate(session.startedDate);
  $('save-status').textContent = '그래프와 메모를 저장하고 있습니다…';
  refresh();
  try {
    const record = createRecordImage();
    const blob = await new Promise(resolve => record.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('이미지를 만들지 못했습니다.');
    const response = await fetch(`/api/extractions?date=${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Shot-Save': '1' },
      body: blob,
    });
    if (response.status === 404 || response.status === 501) {
      throw new Error('최신 Open_Graph.bat로 서버를 다시 실행해주세요.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '파일을 저장하지 못했습니다.');
    $('save-status').textContent = `저장 완료: ${result.path}`;
    await loadHistory();
  } catch (error) {
    $('save-status').textContent = `저장 실패: ${error.message}`;
  } finally {
    saving = false;
    refresh();
  }
});

let historyRequest = 0;

async function loadHistory() {
  const request = ++historyRequest;
  $('history-refresh').disabled = true;
  $('history-status').textContent = '저장된 추출 기록을 불러오는 중…';
  try {
    const response = await fetch('/api/extractions', { cache: 'no-store' });
    if (response.status === 404 || response.status === 501) {
      throw new Error('최신 Open_Graph.bat로 다시 실행해주세요.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '기록을 읽지 못했습니다.');
    if (request !== historyRequest) return;
    const list = document.createDocumentFragment();
    for (const record of result.records) {
      const button = document.createElement('button');
      button.className = 'history-card';
      const title = `${record.date} · 추출 #${String(record.number).padStart(3, '0')}`;
      button.setAttribute('aria-label', `${title} 보기`);
      const image = document.createElement('img');
      image.src = record.url; image.alt = ''; image.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = title;
      const hint = document.createElement('small'); hint.textContent = '그래프와 메모 보기';
      button.append(image, label, hint);
      button.addEventListener('click', () => {
        $('preview-title').textContent = title;
        $('preview-status').textContent = '';
        $('preview-image').src = record.url;
        $('preview-download').href = record.url;
        $('preview-download').download = record.filename;
        $('history-preview').showModal();
      });
      list.append(button);
    }
    $('history-list').replaceChildren(list);
    $('history-status').textContent = result.records.length
      ? `저장된 기록 ${result.records.length}개 · 최신순`
      : '저장된 기록이 없습니다. 추출 완료 후 이미지 저장을 눌러주세요.';
  } catch (error) {
    if (request === historyRequest) $('history-status').textContent = `불러오기 실패: ${error.message}`;
  } finally {
    if (request === historyRequest) $('history-refresh').disabled = false;
  }
}

$('history-refresh').addEventListener('click', loadHistory);
$('preview-close').addEventListener('click', () => $('history-preview').close());
$('preview-image').addEventListener('error', () => {
  $('preview-status').textContent = '이미지를 읽지 못했습니다. 파일이 삭제되거나 이동했는지 확인하고 히스토리를 새로고침하세요.';
});

if (!('serial' in navigator) || !window.isSecureContext) {
  $('connect').disabled = true;
  $('connection').textContent = 'PC용 Chrome 또는 Edge에서 localhost로 열어주세요. 이 브라우저에서는 USB 시리얼 연결을 지원하지 않습니다.';
} else {
  navigator.serial.addEventListener('connect', autoConnect);
  void autoConnect();
}
setInterval(refresh, 100);
refresh();
loadHistory();
