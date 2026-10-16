import concurrent.futures
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('open_graph', Path(__file__).resolve().parents[1] / 'open_graph.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
PNG = b'\x89PNG\r\n\x1a\n' + b'test payload'


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name) / 'data'
        self.server = launcher.create_server(self.directory)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01})
        self.thread.start()
        self.url = 'http://127.0.0.1:{}'.format(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.temporary.cleanup()

    def save(self, date='2026-10-16', origin=None, image=PNG):
        headers = {'Content-Type': 'image/png', 'X-Shot-Save': '1', 'Origin': origin or self.url}
        request = urllib.request.Request(self.url + '/api/extractions?date=' + date, data=image, headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_persistent_numbering_and_no_overwrite(self):
        first = self.save()
        self.assertEqual(first['path'], 'data/2026-10-16_001.png')
        self.assertEqual((self.directory / '2026-10-16_001.png').read_bytes(), PNG)
        (self.directory / '2026-10-16_004.png').write_bytes(PNG)
        self.assertEqual(self.save()['number'], 5)
        self.assertEqual(self.save('2026-10-17')['number'], 1)

    def test_concurrent_saves_use_distinct_files(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            records = list(executor.map(lambda _: self.save(), range(4)))
        self.assertEqual(len({record['path'] for record in records}), 4)
        self.assertEqual(len(list(self.directory.glob('*.png'))), 4)

    def test_rejects_cross_origin_invalid_dates_and_invalid_image(self):
        for kwargs, expected in [({'origin': 'https://example.com'}, 403),
                                 ({'date': '../escape'}, 400),
                                 ({'date': '2026-02-30'}, 400),
                                 ({'image': b'not a png'}, 400)]:
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.save(**kwargs)
                self.assertEqual(error.exception.code, expected)
        self.assertFalse(self.directory.exists())

    def history(self):
        with urllib.request.urlopen(self.url + '/api/extractions') as response:
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            return json.load(response)['records']

    def test_history_empty_and_existing_files_sorted_by_date_and_number(self):
        self.assertEqual(self.history(), [])
        self.directory.mkdir()
        for filename in ['2026-10-16_002.png', '2026-10-17_001.png',
                         '2026-10-16_1000.png', '2026-10-16_999.png', 'other.png', '.gitkeep']:
            (self.directory / filename).write_bytes(PNG)
        records = self.history()
        self.assertEqual([r['filename'] for r in records], [
            '2026-10-17_001.png', '2026-10-16_1000.png', '2026-10-16_999.png', '2026-10-16_002.png'])
        with urllib.request.urlopen(self.url + records[0]['url']) as response:
            self.assertEqual(response.headers['Content-Type'], 'image/png')
            self.assertEqual(response.read(), PNG)
        self.save('2026-10-18')
        self.assertEqual(self.history()[0]['filename'], '2026-10-18_001.png')

    def test_history_does_not_expose_other_files_or_symlinks(self):
        self.directory.mkdir()
        outside = Path(self.temporary.name) / 'private.png'
        outside.write_bytes(PNG)
        (self.directory / '2026-10-16_001.png').symlink_to(outside)
        self.assertEqual(self.history(), [])
        for filename in ['2026-10-16_001.png', '..%2Fprivate.png', 'missing.png']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.url + '/api/extractions/files/' + filename)
            self.assertEqual(error.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
