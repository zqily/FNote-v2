import os
import re
import sys

# ... (APP_DATA_DIR and YT_DLP_UPDATE_URL are unchanged) ...
APP_DATA_DIR = os.path.join(os.path.expanduser('~'), '.fnote')
os.makedirs(APP_DATA_DIR, exist_ok=True)
YT_DLP_UPDATE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"

# Define the new scheme as a constant
LOCAL_DOMAIN = 'https://fnote.local'

def to_web_path(os_path):
    """
    Converts a local OS-specific absolute path to a local HTTPS URI.
    
    Args:
        os_path (str): The OS path (e.g., 'C:\\Users\\...\\.fnote\\songs\\mysong.mp3').
    
    Returns:
        str: The custom URI (e.g., 'https://fnote.local/songs/mysong.mp3'), or None if input is None.
    """
    if os_path is None:
        return None
    
    relative_path = os.path.relpath(os_path, APP_DATA_DIR)
    
    # Use the new fake domain instead of 'fnote://'
    # The leading slash is important for the URL path.
    return f"{LOCAL_DOMAIN}/" + relative_path.replace(os.sep, '/')

def web_to_os_path(web_path):
    """
    Converts a local HTTPS URI back to a local OS-specific absolute path.
    Also handles old custom schemes for backward compatibility.
    
    Args:
        web_path (str): The custom URI or old scheme path.
    
    Returns:
        str: The OS-specific absolute path, or None if input is None.
    """
    if web_path is None:
        return None

    if web_path.startswith(f"{LOCAL_DOMAIN}/"):
        # Handle the new scheme
        path_part = web_path[len(f"{LOCAL_DOMAIN}/"):]
        return os.path.join(APP_DATA_DIR, *path_part.split('/'))
    elif web_path.startswith('fnote://'):
        # Handle old scheme for backward compatibility with existing databases
        path_part = web_path[len('fnote://'):]
        return os.path.join(APP_DATA_DIR, *path_part.split('/'))
    else:
        # Handle very old relative paths
        return os.path.join(APP_DATA_DIR, *web_path.split('/'))

def parse_artist_title(filename):
    """
    Parses a filename into artist and title based on a 'Artist - Title' format.
    
    Args:
        filename (str): The filename (e.g., 'My Artist - My Song.mp3').
    
    Returns:
        tuple: A tuple of (artist, title). Returns (None, filename_without_extension) if format is not matched.
    """
    name_part = os.path.splitext(filename)[0]
    if ' - ' in name_part:
        parts = name_part.split(' - ', 1)
        return parts[0].strip(), parts[1].strip()
    return None, name_part

def parse_search_query(query):
    """
    Parses a search query string into text and tag components.
    
    Args:
        query (str): The search string (e.g., "upbeat t:electronic 'vlog music'").
    
    Returns:
        dict: A dictionary with 'text' and 'tags' keys.
    """
    tag_pattern = r"(?:t:|tag:)(?:'([^']+)'|\"([^\"]+)\"|(\S+))"
    
    # Find all tag values
    found_tags = re.findall(tag_pattern, query, re.IGNORECASE)
    # re.findall returns tuples of capturing groups, e.g., [('electronic', '', ''), ('', 'vlog music', '')]
    # We need to flatten and filter out empty strings.
    tags = [item for sublist in found_tags for item in sublist if item]
    
    # Remove the tag expressions from the query to get the plain text part
    text = re.sub(tag_pattern, '', query, flags=re.IGNORECASE).strip().lower()
    
    return {'text': text, 'tags': [tag.lower() for tag in tags]}

def resource_path(relative_path):
    """
    Get absolute path to resource, works for dev and for PyInstaller.
    This is used for assets that are bundled with the application.
    """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        # Not running in a PyInstaller bundle
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)