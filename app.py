import webview
import concurrent.futures
from threading import Timer
import logging
import mimetypes

import config_handler
from database import DatabaseHandler
from media_manager import MediaManager
import startup
import file_association
from window_manager import WindowManager
from background_services import BackgroundServices
from logger import setup_logging
from python_utils import resource_path
import python_utils
import os

# Import API modules
from api.system_api import SystemApi
from api.song_api import SongApi
from api.playlist_api import PlaylistApi
from api.tag_api import TagApi

class Api:
    """The backend API facade exposed to pywebview. It delegates calls to specialized API modules."""

    def __init__(self):
        """Initializes all backend handlers and API modules."""
        self.logger = logging.getLogger(__name__)
        self.logger.info("Initializing application API...")
        
        # --- Core Handlers ---
        self.db = DatabaseHandler()
        self.startup_handler = startup.get_startup_handler()
        self.association_handler = file_association.get_association_handler()
        config_handler.ensure_config_exists()
        self.config = config_handler.load_config()
        
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self.config_save_timer = None
        
        # --- Managers (instantiated after dependencies) ---
        self.window_manager = WindowManager(self, self.config)
        # MediaManager now needs executor and window_manager for background tasks
        self.media = MediaManager(self.db, self.executor, self.window_manager)
        self.background_services = BackgroundServices(self.config, self.window_manager)

        # --- DB and Directory Init (after MediaManager to ensure yt-dlp check) ---
        self.db.init_database()
        self.media.setup_songs_directory()
        
        # --- API Modules ---
        self.system = SystemApi(self.config, config_handler, self.startup_handler, self.association_handler, self.db, self.media)
        self.song = SongApi(self.db, self.media, self.executor, self.window_manager)
        self.playlist = PlaylistApi(self.db, self.media, self.window_manager)
        self.tag = TagApi(self.db)
        
        # Start background services
        self.background_services.start()
        self.logger.info("Application API initialized successfully.")

    def _save_config_debounced(self):
        """Saves the config file after a short delay to prevent excessive writes."""
        if self.config_save_timer and self.config_save_timer.is_alive():
            self.config_save_timer.cancel()
        self.config_save_timer = Timer(1.0, config_handler.save_config, [self.config])
        self.config_save_timer.start()

    # --- Delegated API Methods ---
    
    # WindowManager methods
    def get_current_player_state(self): return self.window_manager.get_current_player_state()
    def proxy_command_to_main(self, command, args_json="[]"): return self.window_manager.proxy_command_to_main(command, args_json)
    def broadcast_state_change(self, payload): return self.window_manager.broadcast_state_change(payload)
    def toggle_mini_player(self, enable): return self.window_manager.toggle_mini_player(enable)
    def set_mini_player_collapsed(self, is_collapsed): return self.window_manager.set_mini_player_collapsed(is_collapsed)

    # BackgroundServices methods
    def set_auto_pause_enabled(self, enable): return self.background_services.set_auto_pause_enabled(enable)
    def set_discord_presence_enabled(self, enable): return self.background_services.set_discord_presence_enabled(enable)
    def update_rich_presence(self, data): return self.background_services.update_rich_presence(data)
    
    # SystemApi methods
    def register_file_type(self): return self.system.register_file_type()
    def get_startup_file(self): return self.system.get_startup_file()
    def get_initial_config(self): return self.system.get_initial_config()
    def get_initial_data(self): return self.system.get_initial_data()
    def save_volume(self, volume): return self.system.save_volume(volume)
    def save_loop_mode(self, mode): return self.system.save_loop_mode(mode)
    def save_shuffle_mode(self, is_shuffling): return self.system.save_shuffle_mode(is_shuffling)
    def save_sidebar_width(self, width): return self.system.save_sidebar_width(width)
    def save_playlist_section_height(self, height): return self.system.save_playlist_section_height(height)
    def save_toast_duration(self, duration): return self.system.save_toast_duration(duration)
    def save_audio_proc_blacklist(self, blacklist): return self.background_services.save_audio_proc_blacklist(blacklist)
    def save_playback_state(self, state): return self.system.save_playback_state(state)
    def save_active_playlist(self, name): return self.system.save_active_playlist(name)
    def set_run_on_startup(self, enable): return self.system.set_run_on_startup(enable)
    def save_resume_on_startup(self, enable): return self.system.save_resume_on_startup(enable)
    def open_external_link(self, url): return self.system.open_external_link(url)
    def show_in_explorer(self, web_path): return self.system.show_in_explorer(web_path)
    def check_yt_dlp_update(self): return self.system.check_yt_dlp_update()
    def update_yt_dlp(self): return self.system.update_yt_dlp()

    # SongApi methods
    def get_songs_by_paths(self, paths): return self.song.get_songs_by_paths(paths)
    def search_all_songs(self, query): return self.song.search_all_songs(query)
    def search_in_playlist(self, playlist_name, query): return self.song.search_in_playlist(playlist_name, query)
    def import_from_files(self): return self.song.import_from_files()
    def finalize_file_import(self, source_paths): return self.song.finalize_file_import(source_paths)
    def fetch_url_metadata(self, url): return self.song.fetch_url_metadata(url)
    def start_url_download(self, url, indices=None): return self.song.start_url_download(url, indices)
    def get_song_data_uri(self, web_path): return self.song.get_song_data_uri(web_path)
    def get_cover_data(self, web_path): return self.song.get_cover_data(web_path)
    def generate_accent_color(self, web_path): return self.song.generate_accent_color(web_path)
    def refresh_all_accent_colors(self): return self.song.refresh_all_accent_colors()
    def save_song_color(self, path, color): return self.song.save_song_color(path, color)
    def change_song_cover(self, web_path): return self.song.change_song_cover(web_path)
    def delete_songs(self, web_paths): return self.song.delete_songs(web_paths)
    def save_markers(self, path, markers): return self.song.save_markers(path, markers)
    def update_song_details(self, paths, details): return self.song.update_song_details(paths, details)

    # PlaylistApi methods
    def add_songs_to_playlist(self, playlist_name, songs): return self.playlist.add_songs_to_playlist(playlist_name, songs)
    def reorder_playlist_songs(self, playlist_name, song_path_order): return self.playlist.reorder_playlist_songs(playlist_name, song_path_order)
    def reorder_playlists(self, order): return self.playlist.reorder_playlists(order)
    def move_songs_to_playlist(self, source, target, paths): return self.playlist.move_songs_to_playlist(source, target, paths)
    def rename_playlist(self, old_name, new_name): return self.playlist.rename_playlist(old_name, new_name)
    def delete_playlist(self, name): return self.playlist.delete_playlist(name)
    def export_playlist(self, playlist_name): return self.playlist.export_playlist(playlist_name)
    def export_playlist_as_m3u(self, playlist_name): return self.playlist.export_playlist_as_m3u(playlist_name)
    def import_playlist(self, fnlist_path=None): return self.playlist.import_playlist(fnlist_path)

    # TagApi methods
    def create_tag(self, name, category_id): return self.tag.create_tag(name, category_id)
    def rename_tag(self, tag_id, new_name): return self.tag.rename_tag(tag_id, new_name)
    def delete_tag(self, tag_id): return self.tag.delete_tag(tag_id)
    def merge_tags(self, source_tag_id, dest_tag_id): return self.tag.merge_tags(source_tag_id, dest_tag_id)

def url_loader(request):
    """
    A custom loader to handle the 'https://fnote.local' domain. This function intercepts
    requests from the frontend, translates the custom URI to a real file path,
    and serves the file content.
    """
    # We now check for our new fake domain
    if not request.url.startswith(python_utils.LOCAL_DOMAIN):
        return None # Let pywebview handle other requests normally
    try:
        # Use our existing utility function to get the real, absolute OS path
        file_path = python_utils.web_to_os_path(request.url)
        
        if not file_path or not os.path.exists(file_path):
            logging.warning(f"File not found for request: {request.url}")
            return webview.Response(status_code=404, text='File not found')
        
        # Guess the MIME type from the file extension (e.g., 'audio/mpeg' for .mp3)
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = 'application/octet-stream' # Fallback
        
        # Read the file in binary mode and serve it
        with open(file_path, 'rb') as f:
            content = f.read()
        
        logging.info(f"Serving local file: {file_path} as {mime_type}")
        # Allow cross-origin requests for this resource, which can sometimes be necessary
        headers = {'Access-Control-Allow-Origin': '*'}
        return webview.Response(body=content, mime_type=mime_type, headers=headers)
    except Exception as e:
        logging.error(f"Error in url_loader for {request.url}: {e}", exc_info=True)
        return webview.Response(status_code=500, text=f'Internal Server Error: {e}')

if __name__ == '__main__':
    setup_logging()
    api = Api()

    def on_resized(width, height):
        if api.window_manager.windows['main'] and not api.window_manager.windows['main'].hidden:
            api.config['windowWidth'], api.config['windowHeight'] = width, height
            api._save_config_debounced()

    def on_moved(x, y):
        if api.window_manager.windows['main'] and not api.window_manager.windows['main'].hidden:
             api.config['windowX'], api.config['windowY'] = int(x), int(y)
             api._save_config_debounced()

    def on_closing():
        active_window = webview.active_window()
        if api.window_manager.windows['mini'] and active_window is api.window_manager.windows['mini']:
            logging.info("Mini-player closing event intercepted. Switching back to main window.")
            api.toggle_mini_player(False)
            return False
        logging.info("Main window closing. Saving config.")
        api._save_config_debounced()

    def on_closed():
        logging.info("Window closed. Shutting down services.")
        if api.config_save_timer and api.config_save_timer.is_alive():
            api.config_save_timer.cancel()
        config_handler.save_config(api.config)
        api.background_services.shutdown()
        api.executor.shutdown(wait=False)

    main_window = api.window_manager.create_main_window()
    main_window.url_loader = url_loader
    
    main_window.events.resized += on_resized
    main_window.events.moved += on_moved
    main_window.events.closing += on_closing
    main_window.events.closed += on_closed
    
    icon_path = resource_path('favicon.ico')
    try:
        logging.info("Starting webview...")
        webview.start(debug=False, icon=icon_path)
    finally:
        logging.info("Webview closed. Final shutdown.")
        api.background_services.shutdown()