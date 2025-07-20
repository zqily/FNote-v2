import webview
import threading
import time
import json
import logging
from python_utils import resource_path

logger = logging.getLogger(__name__)

def ease_out_quad(t):
    """A quadratic easing function that decelerates to a zero velocity."""
    return t * (2 - t)

class WindowManager:
    def __init__(self, api_facade, config):
        self.api = api_facade
        self.config = config
        self.windows = {'main': None, 'mini': None}
        
        # Mini-player animation state
        self.mini_player_anim_lock = threading.Lock()
        self.active_anim_thread = None
        self.stop_anim_event = threading.Event()
        
        # Mini-player dimensions
        self.MINI_WIDTH_EXPANDED = 350
        self.MINI_WIDTH_COLLAPSED = 74
        self.MINI_HEIGHT = 80

    def create_main_window(self):
        """Creates and returns the main application window."""
        logger.info("Creating main window.")
        window = webview.create_window(
            'FNote', resource_path('index.html'), js_api=self.api,
            min_size=(800, 600), resizable=True,
            width=self.config.get('windowWidth', 1150),
            height=self.config.get('windowHeight', 750),
            x=self.config.get('windowX'),
            y=self.config.get('windowY')
        )
        self.windows['main'] = window
        return window

    def create_mini_player_window(self):
        """Creates and returns the mini-player window."""
        logger.info("Creating mini-player window.")
        screen = webview.screens[0]
        width, height = self.MINI_WIDTH_EXPANDED, self.MINI_HEIGHT
        x, y = screen.width - width - 0, screen.height - height - 80
        window = webview.create_window(
            'FNote Mini-Player', resource_path('mini_player.html'), js_api=self.api,
            width=width, height=height, x=x, y=y,
            resizable=True, frameless=True, on_top=True,
            background_color='#000000'
        )
        self.windows['mini'] = window
        return window

    def broadcast_js(self, js_code):
        """Executes a JS code snippet on all active windows."""
        for window in (self.windows['main'], self.windows['mini']):
            if window and window in webview.windows:
                try: window.evaluate_js(js_code)
                except Exception as e: logger.info(f"Could not broadcast to a closed or invalid window: {e}")

    def get_current_player_state(self):
        """Gets the full current state from the main window's JS context."""
        if self.windows['main']:
            try: return self.windows['main'].evaluate_js('window.getCurrentStateForSync()')
            except Exception as e: logger.error(f"Could not get state from main window: {e}")
        return None

    def proxy_command_to_main(self, command, args_json="[]"):
        """Proxies a command from a secondary window to the main window's JS Player module."""
        if self.windows['main']:
            try:
                safe_args = json.dumps(args_json)
                self.windows['main'].evaluate_js(f'window.handleCommand("{command}", {safe_args})')
            except Exception as e: logger.error(f"Could not proxy command '{command}' to main window: {e}")

    def broadcast_state_change(self, payload):
        """Broadcasts a state change to all windows."""
        if self.windows['mini']:
             safe_payload = json.dumps(payload)
             # Check if the function exists in JS before calling it to prevent race conditions on window creation.
             js_code = f"if (typeof window.handleStateUpdate === 'function') {{ window.handleStateUpdate({safe_payload}); }}"
             try: self.windows['mini'].evaluate_js(js_code)
             except Exception as e: logger.info(f"Could not broadcast state to mini-player (it might be closed): {e}")

    def toggle_mini_player(self, enable):
        """Shows/hides the main window and mini-player."""
        logger.info(f"Toggling mini-player. Enable: {enable}")
        main, mini = self.windows.get('main'), self.windows.get('mini')
        if enable:
            if main: main.hide()
            if not mini or mini not in webview.windows: self.windows['mini'] = self.create_mini_player_window()
            else: mini.show()
        else:
            if mini: mini.destroy(); self.windows['mini'] = None
            if main: main.show()
            else: self.windows['main'] = self.create_main_window()
        return {'status': 'success'}

    def _animate_window(self, window_ref, start_x, start_y, start_w, start_h, end_x, end_y, end_w, end_h, duration, stop_event):
        start_time = time.time()
        while True:
            if stop_event.is_set(): return
            elapsed, progress = time.time() - start_time, min((time.time() - start_time) / duration, 1.0)
            eased_progress = ease_out_quad(progress)
            current_x, current_y = int(start_x + (end_x - start_x) * eased_progress), int(start_y + (end_y - start_y) * eased_progress)
            current_w, current_h = int(start_w + (end_w - start_w) * eased_progress), int(start_h + (end_h - start_h) * eased_progress)
            try:
                if window_ref not in webview.windows: break
                window_ref.move(current_x, current_y)
                window_ref.resize(current_w, current_h)
            except Exception as e:
                logger.info(f"Window animation interrupted: {e}"); break
            if progress >= 1.0:
                try:
                    if window_ref in webview.windows: window_ref.move(end_x, end_y); window_ref.resize(end_w, end_h)
                except: pass
                break
            time.sleep(1/120)

    def _animate_window_geometry(self, window_ref, end_x, end_y, end_w, end_h, duration=0.2):
        if not window_ref or window_ref not in webview.windows: return
        if self.active_anim_thread and self.active_anim_thread.is_alive():
            self.stop_anim_event.set()
            self.active_anim_thread.join(timeout=0.1)
        self.stop_anim_event.clear()
        start_x, start_y, start_w, start_h = window_ref.x, window_ref.y, window_ref.width, window_ref.height
        if start_x == end_x and start_y == end_y and start_w == end_w and start_h == end_h: return
        thread = threading.Thread(target=self._animate_window, args=(window_ref, start_x, start_y, start_w, start_h, end_x, end_y, end_w, end_h, duration, self.stop_anim_event), daemon=True)
        self.active_anim_thread = thread
        thread.start()

    def set_mini_player_collapsed(self, is_collapsed):
        """Resizes and repositions the mini-player to be collapsed or expanded, with an interruptible animation."""
        with self.mini_player_anim_lock:
            mini_window = self.windows.get('mini')
            if not mini_window or mini_window not in webview.windows:
                return {'status': 'error', 'message': 'Mini-player not found or has been closed.'}
            try:
                screen = webview.screens[0]
                x_padding, y_padding, target_y = 0, 80, screen.height - self.MINI_HEIGHT - 80
                if is_collapsed:
                    target_width = self.MINI_WIDTH_COLLAPSED
                    target_x = screen.width - target_width - x_padding
                else:
                    target_width = self.MINI_WIDTH_EXPANDED
                    target_x = screen.width - target_width - x_padding
                self._animate_window_geometry(mini_window, target_x, target_y, target_width, self.MINI_HEIGHT, 0.25)
                return {'status': 'success'}
            except Exception as e:
                logger.error(f"Failed to resize mini-player: {e}", exc_info=True)
                return {'status': 'error', 'message': str(e)}