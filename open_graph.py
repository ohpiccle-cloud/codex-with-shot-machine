"""Open the local pressure graph using only the Python standard library."""

import argparse
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import json
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import sys
import webbrowser
from urllib.parse import parse_qs, urlsplit


GRAPH_DIRECTORY = Path(__file__).resolve().parent / 'graph'
DATA_DIRECTORY = Path(__file__).resolve().parent / 'data'
RECORD_NAME = re.compile(r'(\d{4}-\d{2}-\d{2})_(\d+)\.png')


class BrowserWindows:
    def __init__(self, grace=3, clock=time.monotonic):
        self.grace = grace
        self.clock = clock
        self.active = set()
        self.closed = {}
        self.deadline = None
        self.lock = threading.Lock()

    def update(self, token, opened):
        with self.lock:
            now = self.clock()
            self.closed = {key: stamp for key, stamp in self.closed.items() if now - stamp < 60}
            if opened:
                # A fast tab close can arrive before its initial registration.
                if token not in self.closed:
                    self.active.add(token)
                if self.active:
                    self.deadline = None
                elif self.deadline is None:
                    self.deadline = now + self.grace
            else:
                known = token in self.active
                self.active.discard(token)
                self.closed[token] = now
                if known and not self.active:
                    self.deadline = now + self.grace

    def expired(self):
        with self.lock:
            return self.deadline is not None and self.clock() >= self.deadline


class GraphHandler(SimpleHTTPRequestHandler):
    def respond_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        directory = self.server.data_directory
        if path == '/api/extractions':
            try:
                records = []
                if directory.exists():
                    for file in directory.iterdir():
                        match = RECORD_NAME.fullmatch(file.name)
                        if match and not file.is_symlink() and file.is_file():
                            records.append({'filename': file.name, 'date': match.group(1),
                                            'number': int(match.group(2)),
                                            'url': '/api/extractions/files/' + file.name})
                records.sort(key=lambda record: (record['date'], record['number']), reverse=True)
                self.respond_json(200, {'records': records})
            except OSError:
                self.respond_json(500, {'error': 'data 폴더를 읽지 못했습니다. 폴더 접근 권한을 확인해주세요.'})
            return
        if path.startswith('/api/extractions/files/'):
            filename = path[len('/api/extractions/files/'):]
            if not RECORD_NAME.fullmatch(filename):
                self.respond_json(404, {'error': '추출 기록을 찾을 수 없습니다.'})
                return
            file = directory / filename
            try:
                if file.is_symlink() or not file.is_file():
                    self.respond_json(404, {'error': '추출 기록을 찾을 수 없습니다.'})
                    return
                image = file.read_bytes()
            except OSError:
                self.respond_json(404, {'error': '추출 이미지를 읽지 못했습니다.'})
                return
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(image)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(image)
            return
        super().do_GET()

    def do_POST(self):
        address = urlsplit(self.path)
        if address.path not in ('/api/extractions', '/api/window/open', '/api/window/close'):
            self.respond_json(404, {'error': '저장 경로를 찾을 수 없습니다.'})
            return
        hosts = {'127.0.0.1:{}'.format(self.server.server_port),
                 'localhost:{}'.format(self.server.server_port)}
        origin = self.headers.get('Origin')
        if (self.headers.get('Host') not in hosts
                or (address.path != '/api/window/close' and self.headers.get('X-Shot-Save') != '1')
                or (origin is not None and origin not in {'http://' + host for host in hosts})):
            self.respond_json(403, {'error': '이 프로그램 화면에서만 저장할 수 있습니다.'})
            return
        if address.path.startswith('/api/window/'):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length != 32:
                    raise ValueError('Invalid token length')
                self.connection.settimeout(5)
                token = self.rfile.read(length).decode('ascii')
                if not re.fullmatch(r'[a-f0-9]{32}', token):
                    raise ValueError('Invalid token')
            except (ValueError, UnicodeError):
                self.respond_json(400, {'error': '잘못된 창 식별자입니다.'})
                return
            self.server.windows.update(token, address.path.endswith('/open'))
            self.respond_json(200, {'ok': True})
            return
        try:
            extraction_date = parse_qs(address.query).get('date', [''])[0]
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', extraction_date):
                raise ValueError('Invalid date')
            date.fromisoformat(extraction_date)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16 * 1024 * 1024:
                raise ValueError('Invalid image size')
            if self.headers.get('Content-Type') != 'image/png':
                raise ValueError('Invalid image type')
        except ValueError:
            self.respond_json(400, {'error': '날짜 또는 PNG 이미지 형식이 올바르지 않습니다.'})
            return
        self.connection.settimeout(15)
        image = self.rfile.read(length)
        if len(image) != length or not image.startswith(b'\x89PNG\r\n\x1a\n'):
            self.respond_json(400, {'error': 'PNG 이미지를 받지 못했습니다.'})
            return
        try:
            directory = self.server.data_directory
            directory.mkdir(parents=True, exist_ok=True)
            pattern = re.compile(re.escape(extraction_date) + r'_(\d+)\.png')
            numbers = [int(match.group(1)) for path in directory.iterdir()
                       if (match := pattern.fullmatch(path.name))]
            number = max(numbers, default=0) + 1
            while True:
                filename = '{}_{:03d}.png'.format(extraction_date, number)
                target = directory / filename
                try:
                    output = target.open('xb')
                    break
                except FileExistsError:
                    number += 1
            try:
                with output:
                    output.write(image)
            except OSError:
                target.unlink(missing_ok=True)
                raise
        except OSError:
            self.respond_json(500, {'error': 'data 폴더의 쓰기 권한과 디스크 여유 공간을 확인해주세요.'})
            return
        self.respond_json(201, {'path': 'data/' + filename, 'number': number})


def create_server(data_directory=DATA_DIRECTORY, port=0):
    handler = partial(GraphHandler, directory=str(GRAPH_DIRECTORY))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    server.data_directory = Path(data_directory)
    server.windows = BrowserWindows()
    return server


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

    # Web Serial grants belong to an origin, including its port number.
    try:
        server = create_server(port=10001)
    except OSError as error:
        print('서버를 실행하지 못했습니다: {}'.format(error))
        print('기존 실행창을 종료하고 다시 실행하세요. 고정 포트 10001이 필요합니다.')
        input('Enter를 누르면 닫힙니다. ')
        return 1
    with server:
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:{}/'.format(server.server_port)
        print('추출 그래프 실행 중: ' + url, flush=True)
        print('Chrome 또는 Edge에서 아두이노 연결을 눌러주세요.', flush=True)
        print('종료 전 그래프 이미지를 저장하세요. 마지막 그래프 탭을 닫으면 약 3초 후 프로그램도 종료됩니다.', flush=True)
        print('이 창에서 Enter 또는 Ctrl+C로도 종료할 수 있습니다.', flush=True)
        try:
            if not args.no_browser:
                open_browser(url)
            while not server.windows.expired():
                if os.name == 'nt':
                    import msvcrt
                    if msvcrt.kbhit() and msvcrt.getwch() in ('\r', '\n'):
                        break
                elif sys.stdin.isatty():
                    import select
                    if select.select([sys.stdin], [], [], 0)[0]:
                        sys.stdin.readline()
                        break
                time.sleep(0.2)
        except KeyboardInterrupt:
            pass
        finally:
            server.shutdown()
            thread.join()
    print('\n추출 그래프 서버를 종료했습니다.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
