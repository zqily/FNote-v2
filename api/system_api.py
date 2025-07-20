import sys
import requests
from packaging.version import parse as parse_version
import logging
from python_utils import YT_DLP_UPDATE_URL

logger = logging.getLogger(__name__)

class SystemApi:
    def __init__(self, config, config_handler, startup_handler, association_handler, db_handler, media_manager):
        self.config = config
        self.config_handler = config_handler
        self.startup_handler = startup_handler
        self.association_handler = association_handler
        self.db = db_handler
        self.media = media_manager
        
        self.is_startup_launch = "--from-startup" in sys.argv
        self.startup_file = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].lower().endswith('.fnlist') else None
        if self.is_startup_launch:
            logger.info("Application launched from system startup.")
        if self.startup_file:
            logger.info(f"Application launched with file: {self.startup_file}")

    def register_file_type(self):
        """Registers the .fnlist file type with the application."""
        try:
            self.association_handler.register()
            return {'status': 'success', 'message': '.fnlist file type registered.'}
        except PermissionError as e:
            return {'status': 'error', 'message': str(e)}
        except Exception as e:
            logger.error("Error registering file type: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def get_startup_file(self):
        """Returns the path of a file the app was opened with, then clears it."""
        startup_file_path = self.startup_file
        self.startup_file = None
        return startup_file_path

    def get_initial_config(self):
        """Returns the initial application configuration to the frontend."""
        logger.info("Fetching initial configuration for frontend.")
        config_with_status = self.config.copy()
        config_with_status['system_status'] = {'has_ffmpeg': self.media.has_ffmpeg, 'platform': sys.platform}
        config_with_status['isStartupLaunch'] = self.is_startup_launch
        return config_with_status

    def get_initial_data(self):
        """Returns all necessary music library and tag data to the frontend."""
        logger.info("Fetching initial data for frontend.")
        try:
            return self.db.get_initial_data(self.config.get('activePlaylist', 'Default'))
        except Exception as e:
            logger.error("Failed to get initial data from database: %s", e, exc_info=True)
            raise

    def save_volume(self, volume):
        self.config['volume'] = int(volume)
        self.config_handler.save_config(self.config)

    def save_loop_mode(self, mode):
        self.config['loopMode'] = mode
        self.config_handler.save_config(self.config)

    def save_shuffle_mode(self, is_shuffling):
        self.config['isShuffling'] = bool(is_shuffling)
        self.config_handler.save_config(self.config)
        
    def save_sidebar_width(self, width):
        self.config['sidebarWidth'] = int(width)
        self.config_handler.save_config(self.config)

    def save_playlist_section_height(self, height):
        self.config['playlistSectionHeight'] = int(height)
        self.config_handler.save_config(self.config)

    def save_toast_duration(self, duration):
        self.config['toastDuration'] = float(duration)
        self.config_handler.save_config(self.config)

    def save_playback_state(self, state):
        self.config.update({
            'lastPlayedSongPath': state.get('path'),
            'lastPlayedTime': state.get('time'),
            'lastPlayedPlaylist': state.get('playlist')
        })
        self.config_handler.save_config(self.config)

    def save_active_playlist(self, name):
        self.config['activePlaylist'] = name
        self.config_handler.save_config(self.config)
        return {'status': 'success'}

    def set_run_on_startup(self, enable):
        """Enables or disables the application from running on system startup."""
        try:
            if enable: self.startup_handler.enable()
            else: self.startup_handler.disable()
            self.config['runOnStartup'] = bool(enable)
            self.config_handler.save_config(self.config)
            return {'status': 'success'}
        except Exception as e:
            logger.error("Error setting run on startup: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}
            
    def save_resume_on_startup(self, enable):
        """Saves the 'resume on startup' setting."""
        self.config['resumeOnStartup'] = bool(enable)
        self.config_handler.save_config(self.config)
        return {'status': 'success'}

    def open_external_link(self, url):
        self.media.open_external_link(url)

    def show_in_explorer(self, web_path):
        return self.media.show_in_explorer(web_path)
        
    def check_yt_dlp_update(self):
        """Checks if a newer version of the yt-dlp executable is available on GitHub."""
        current_version_str = self.media.get_yt_dlp_version()
        if current_version_str in ("Not Found", "Error"):
            return {'status': 'error', 'message': 'Could not determine current yt-dlp version.', 'current_version': current_version_str}

        try:
            logger.info(f"Checking for yt-dlp update. Current version: {current_version_str}")
            response = requests.get(YT_DLP_UPDATE_URL, timeout=10)
            response.raise_for_status()
            latest_version_str = response.json()['tag_name']
            
            current_version = parse_version(current_version_str)
            latest_version = parse_version(latest_version_str)

            if latest_version > current_version:
                logger.info(f"yt-dlp update available: {current_version_str} -> {latest_version_str}")
                return {'status': 'update_available', 'latest_version': latest_version_str, 'current_version': current_version_str}
            else:
                logger.info(f"yt-dlp is up to date (version {current_version_str}).")
                return {'status': 'up_to_date', 'current_version': current_version_str}
        except Exception as e:
            logger.warning(f"Could not check for yt-dlp update from GitHub: {e}")
            return {'status': 'error', 'message': str(e), 'current_version': current_version_str}

    def update_yt_dlp(self):
        """Updates the yt-dlp executable by downloading the latest release from GitHub."""
        try:
            logger.info("Starting yt-dlp executable update via System API...")
            result = self.media.update_yt_dlp_executable()
            return result
        except Exception as e:
            logger.error(f"An unexpected error occurred during yt-dlp update: {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}