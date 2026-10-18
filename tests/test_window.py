import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('open_graph', Path(__file__).resolve().parents[1] / 'open_graph.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.windows = launcher.BrowserWindows(clock=lambda: self.now)

    def test_final_window_close_stops_after_grace(self):
        self.windows.update('first', True)
        self.now = 100000
        self.assertFalse(self.windows.expired())  # Background tabs never expire.
        self.windows.update('first', False)
        self.now += 2.9
        self.assertFalse(self.windows.expired())
        self.now += 0.2
        self.assertTrue(self.windows.expired())

    def test_reload_cancels_shutdown_and_last_of_multiple_tabs_controls_exit(self):
        self.windows.update('first', True)
        self.windows.update('first', False)
        self.now = 1
        self.windows.update('reload', True)
        self.now = 10
        self.assertFalse(self.windows.expired())
        self.windows.update('second', True)
        self.windows.update('reload', False)
        self.now = 20
        self.assertFalse(self.windows.expired())
        self.windows.update('second', False)
        self.now = 24
        self.assertTrue(self.windows.expired())

    def test_fast_close_before_registration_does_not_leave_ghost_window(self):
        self.windows.update('fast', False)
        self.windows.update('fast', True)
        self.now = 4
        self.assertTrue(self.windows.expired())

    def test_unknown_close_does_not_stop_a_running_window(self):
        self.windows.update('real', True)
        self.windows.update('unknown', False)
        self.now = 999
        self.assertFalse(self.windows.expired())
