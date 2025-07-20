import json
import os
import logging
from python_utils import APP_DATA_DIR

logger = logging.getLogger(__name__)
CONFIG_FILE = os.path.join(APP_DATA_DIR, 'FConf.json')

def get_default_config():
    """Returns the default configuration dictionary."""
    return {
        'volume': 100,
        'loopMode': 'none',
        'isShuffling': False,
        'activePlaylist': 'Default',
        'sidebarWidth': 300,
        'playlistSectionHeight': 150,
        'lastPlayedSongPath': None,
        'lastPlayedTime': 0,
        'lastPlayedPlaylist': 'Default',
        'toastDuration': 3,
        'runOnStartup': False,
        'resumeOnStartup': False,
        'autoPauseOnExternalAudio': False,
        'discordRichPresence': False,
        'autoPauseAudioProcBlacklist': [
            'fxsound.exe',
            'msedgewebview2.exe',
            'obs64.exe',
            'obs32.exe',
            'lively.exe',
            'wallpaper64.exe',
            'wallpaper32.exe',
            'voicemeeter.exe',
            'voicemeeterpro.exe',
            'voicemeeterpotato.exe',
            'soundlock.exe',
            'nvcontainer.exe',
            'audiodg.exe',
            'ShellExperienceHost.exe'
        ],
        'windowWidth': 1150,
        'windowHeight': 750,
        'windowX': None,
        'windowY': None
    }

def load_config():
    """
    Loads configuration from FConf.json.
    If the file doesn't exist or is invalid, it returns the default configuration.
    """
    default_config = get_default_config()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                loaded_conf = json.load(f)
                # Merge loaded config into defaults to ensure all keys are present
                default_config.update(loaded_conf)
                logger.info("Configuration loaded from FConf.json")
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Could not load config file '{CONFIG_FILE}'. Using defaults. Error: {e}")
    else:
        logger.info("No config file found. Using default configuration.")
    return default_config

def save_config(config_data):
    """
    Saves the provided configuration dictionary to FConf.json.
    
    Args:
        config_data (dict): The configuration dictionary to save.
    """
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=4)
        logger.debug("Configuration saved to FConf.json")
    except IOError as e:
        logger.error(f"Could not save config file '{CONFIG_FILE}'. Error: {e}")

def ensure_config_exists():
    """Ensures the config file exists, creating it with defaults if not."""
    if not os.path.exists(CONFIG_FILE):
        logger.info(f"Config file '{CONFIG_FILE}' not found. Creating with default values.")
        save_config(get_default_config())