"""Open the local pressure graph using only the Python standard library."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import threading
import webbrowser


GRAPH_DIRECTORY = Path(__file__).resolve().parent / 'graph'


def open_browser(url):
    # Web Serial requires desktop Chrome or Edge. Prefer one over the default browser.
    candidates = []
    if os.name == 'nt':
        roots = []
        for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            base = os.environ.get(variable)
            if base:
                roots.append(Path(base))
        candidates.extend(str(base / 'Google/Chrome/Application/chrome.exe') for base in roots)
        candidates.extend(str(base / 'Microsoft/Edge/Application/msedge.exe') for base in roots)
    candidates.extend(['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'])
    for candidate in candidates:
        executable = shutil.which(candidate)
        if executable:
            try:
                subprocess.Popen([executable, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except OSError:
                continue
    try:
        webbrowser.open(url)
    except webbrowser.Error:
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true', help='Run without opening a browser')
    args = parser.parse_args()
    if not (GRAPH_DIRECTORY / 'index.html').is_file():
        print('graph/index.html 파일이 없습니다. 저장소 전체를 다운로드하고 압축을 풀어주세요.')
        input('Enter를 누르면 닫힙니다. ')
        return 1

    handler = partial(SimpleHTTPRequestHandler, directory=str(GRAPH_DIRECTORY))
    # An available local port avoids collisions with previously opened servers.
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:{}/'.format(server.server_port)
        print('추출 그래프 실행 중: ' + url, flush=True)
        print('Chrome 또는 Edge에서 아두이노 연결을 눌러주세요.', flush=True)
        print('종료 전 CSV를 저장하세요. 브라우저 탭만 닫으면 서버는 계속 실행됩니다.', flush=True)
        try:
            if not args.no_browser:
                open_browser(url)
            input('이 창에서 Enter를 누르면 서버가 종료됩니다. ')
        except (KeyboardInterrupt, EOFError):
            pass
        finally:
            server.shutdown()
            thread.join()
    print('\n추출 그래프 서버를 종료했습니다.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
