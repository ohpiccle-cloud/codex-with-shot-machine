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
import webbrowser
from urllib.parse import parse_qs, urlsplit


GRAPH_DIRECTORY = Path(__file__).resolve().parent / 'graph'
DATA_DIRECTORY = Path(__file__).resolve().parent / 'data'
RECORD_NAME = re.compile(r'(\d{4}-\d{2}-\d{2})_(\d+)\.png')


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
        if address.path != '/api/extractions':
            self.respond_json(404, {'error': '저장 경로를 찾을 수 없습니다.'})
            return
        hosts = {'127.0.0.1:{}'.format(self.server.server_port),
                 'localhost:{}'.format(self.server.server_port)}
        origin = self.headers.get('Origin')
        if (self.headers.get('Host') not in hosts
                or self.headers.get('X-Shot-Save') != '1'
                or (origin is not None and origin not in {'http://' + host for host in hosts})):
            self.respond_json(403, {'error': '이 프로그램 화면에서만 저장할 수 있습니다.'})
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


def create_server(data_directory=DATA_DIRECTORY):
    handler = partial(GraphHandler, directory=str(GRAPH_DIRECTORY))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    server.data_directory = Path(data_directory)
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

    # An available local port avoids collisions with previously opened servers.
    with create_server() as server:
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:{}/'.format(server.server_port)
        print('추출 그래프 실행 중: ' + url, flush=True)
        print('Chrome 또는 Edge에서 아두이노 연결을 눌러주세요.', flush=True)
        print('종료 전 그래프 이미지를 저장하세요. 브라우저 탭만 닫으면 서버는 계속 실행됩니다.', flush=True)
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
