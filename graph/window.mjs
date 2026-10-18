// Explicit close notifications avoid shutting down a throttled background tab.
let token = null;
function opened() {
  token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  void fetch('/api/window/open', {
    method: 'POST', headers: { 'X-Shot-Save': '1' }, body: token, keepalive: true,
  }).then(response => {
    if (!response.ok) console.warn('자동 종료 등록 실패: 최신 실행 프로그램으로 다시 실행해주세요.');
  }).catch(error => console.warn('자동 종료 등록 실패:', error));
}
function closed() {
  if (!token) return;
  const closingToken = token;
  token = null;
  if (!navigator.sendBeacon('/api/window/close', closingToken)) {
    void fetch('/api/window/close', { method: 'POST', body: closingToken, keepalive: true }).catch(() => {});
  }
}
window.addEventListener('pageshow', opened);
window.addEventListener('pagehide', closed);
