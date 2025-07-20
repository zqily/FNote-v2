import os
import shutil
import base64
import colorsys
import subprocess
import sys
import webbrowser
import requests
import json
import tempfile
import zipfile
import stat
import threading
import numpy as np
import mutagen
import logging
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.m4a import M4A
from mutagen.id3 import APIC
from mutagen.mp4 import MP4Cover
from PIL import Image
from contextlib import contextmanager

import python_utils as utils
from python_utils import YT_DLP_UPDATE_URL

SONGS_DIR = os.path.join(utils.APP_DATA_DIR, 'songs')

logger = logging.getLogger(__name__)

def _vectorized_rgb_to_hsv(rgb):
    """
    Converts an array of RGB values to HSV using NumPy for vectorization.
    Input: rgb is a NumPy array of shape (n, 3) with values in [0, 1].
    Output: hsv is a NumPy array of shape (n, 3) with values in [0, 1].
    """
    eps = 1e-7 # Epsilon to prevent division by zero
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    maxc, minc = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    v, delta = maxc, maxc - minc
    s = np.where(maxc > eps, delta / maxc, 0)
    h = np.zeros_like(v)
    rc, gc, bc = (maxc - r) / (delta + eps), (maxc - g) / (delta + eps), (maxc - b) / (delta + eps)
    idx_r, idx_g, idx_b = (r == maxc), (g == maxc) & ~idx_r, (b == maxc) & ~idx_r & ~idx_g
    h[idx_r], h[idx_g], h[idx_b] = bc[idx_r] - gc[idx_r], 2.0 + rc[idx_g] - bc[idx_g], 4.0 + gc[idx_b] - rc[idx_b]
    h = (h / 6.0) % 1.0
    h[delta < eps] = 0
    return np.stack((h, s, v), axis=-1)

class MediaManager:
    """Handles file system operations, metadata extraction, and media processing."""

    def __init__(self, db_handler, executor, window_manager):
        self.db_handler = db_handler
        self.executor = executor
        self.window_manager = window_manager
        self.ffmpeg_path = self._find_ffmpeg()
        self.has_ffmpeg = self.ffmpeg_path is not None
        self.bin_dir = os.path.join(utils.APP_DATA_DIR, 'bin')
        self.yt_dlp_path = self._get_yt_dlp_path()
        self._ensure_yt_dlp_exists()
        
        self.long_task_lock = threading.Lock()
        self.active_task_name = None

    def _get_yt_dlp_path(self):
        """Determines the platform-specific path for the yt-dlp executable."""
        if sys.platform == "win32": return os.path.join(self.bin_dir, 'yt-dlp.exe')
        return os.path.join(self.bin_dir, 'yt-dlp')

    def _ensure_yt_dlp_exists(self):
        """Checks for the yt-dlp executable and downloads it if it's missing."""
        if not os.path.exists(self.yt_dlp_path):
            logger.info("yt-dlp not found. Attempting to download the latest version...")
            try: self.update_yt_dlp_executable()
            except Exception as e: logger.error(f"FATAL: Could not download yt-dlp. URL downloads will fail. Error: {e}")

    def get_yt_dlp_version(self):
        """Returns the version of the local yt-dlp executable."""
        if not os.path.exists(self.yt_dlp_path): return "Not Found"
        try:
            # Add creationflags on Windows to suppress the console window
            startupinfo = None
            if sys.platform == "win32":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE

            result = subprocess.run(
                [self.yt_dlp_path, '--version'],
                capture_output=True,
                text=True,
                check=True,
                startupinfo=startupinfo  # Pass the new info here
            )
            return result.stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError): return "Error"

    def update_yt_dlp_executable(self):
        """Downloads the latest yt-dlp executable from GitHub atomically."""
        logger.info("Fetching latest yt-dlp release information...")
        response = requests.get(YT_DLP_UPDATE_URL, timeout=10)
        response.raise_for_status()
        assets, asset_name = response.json().get('assets', []), 'yt-dlp'
        if sys.platform == "win32": asset_name = 'yt-dlp.exe'
        elif sys.platform == "darwin": asset_name = 'yt-dlp_macos'
        asset_url = next((asset['browser_download_url'] for asset in assets if asset['name'] == asset_name), None)
        if not asset_url: raise Exception(f"Could not find a download link for '{asset_name}'.")

        os.makedirs(self.bin_dir, exist_ok=True)
        
        # Download to a temporary file in the same directory to ensure atomic move/rename
        temp_file_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, dir=self.bin_dir, suffix='.tmp') as temp_file:
                temp_file_path = temp_file.name
                logger.info(f"Downloading {asset_name} to temporary file {temp_file_path}...")
                with requests.get(asset_url, stream=True, timeout=30) as r:
                    r.raise_for_status()
                    for chunk in r.iter_content(chunk_size=8192):
                        temp_file.write(chunk)
            
            # If download is successful, make it executable and move it to the final destination
            if sys.platform != "win32":
                os.chmod(temp_file_path, os.stat(temp_file_path).st_mode | stat.S_IEXEC)
            
            shutil.move(temp_file_path, self.yt_dlp_path)
            logger.info("yt-dlp has been successfully downloaded/updated.")
            return {'status': 'success'}

        except Exception as e:
            # Clean up the temporary file on error
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            raise e # Re-raise the exception to be handled by the caller

    def setup_songs_directory(self):
        os.makedirs(SONGS_DIR, exist_ok=True)

    def _find_ffmpeg(self):
        """
        Finds the ffmpeg executable, prioritizing a bundled version when frozen.
        Logs the search process in detail.
        """
        logger.info("Searching for FFmpeg executable...")
        # Priority 1: Bundled FFmpeg (when running as a PyInstaller executable)
        if getattr(sys, 'frozen', False):
            logger.info("Running as a frozen executable. Prioritizing bundled FFmpeg.")
            exe_name = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
            
            # PyInstaller places binaries from the .spec file's `binaries` list
            # into an `_internal` subdirectory relative to the main executable.
            base_dir = os.path.dirname(sys.executable)
            bundled_path = os.path.join(base_dir, '_internal', exe_name)
            
            logger.info(f"Checking for bundled FFmpeg at: {bundled_path}")
            if os.path.exists(bundled_path):
                logger.info(f"SUCCESS: Using bundled FFmpeg found at: {bundled_path}")
                return bundled_path
            else:
                logger.warning("Bundled FFmpeg not found at the expected location. Falling back to system PATH.")
        else:
            logger.info("Running as a script. Bundled FFmpeg check is skipped. Searching system PATH.")
        
        # Priority 2: FFmpeg in system PATH (fallback)
        system_path = shutil.which('ffmpeg')
        if system_path:
            logger.info(f"SUCCESS: Using system FFmpeg found in PATH: {system_path}")
            return system_path
        
        logger.warning("FFmpeg not found. URL downloads will not be available.")
        return None

    # --- METADATA AND FILE PROCESSING (UNCHANGED) ---
    def _extract_metadata_from_file(self, filepath):
        name, artist, cover_path = None, None, None
        base_name, _ = os.path.splitext(os.path.basename(filepath))
        try:
            audio_easy = mutagen.File(filepath, easy=True)
            if audio_easy:
                name, artist = audio_easy.get('title', [None])[0], audio_easy.get('artist', [None])[0]
            if not name:
                parsed_artist, parsed_name = utils.parse_artist_title(os.path.basename(filepath))
                name = parsed_name
                if not artist: artist = parsed_artist
            audio = mutagen.File(filepath)
            if not audio: raise ValueError("Mutagen could not parse the file.")
            cover_data, ext = None, None
            if isinstance(audio, MP3) and 'APIC:' in audio.tags:
                artwork = audio.tags['APIC:']
                cover_data, ext = artwork.data, 'png' if 'png' in artwork.mime else 'jpg'
            elif isinstance(audio, FLAC) and audio.pictures:
                artwork = audio.pictures[0]
                cover_data, ext = artwork.data, 'png' if 'png' in artwork.mime else 'jpg'
            elif isinstance(audio, M4A) and 'covr' in audio.tags and audio.tags['covr']:
                artwork = audio.tags['covr'][0]
                cover_data, ext = artwork, 'png' if artwork.imageformat == MP4Cover.FORMAT_PNG else 'jpg'
            if cover_data:
                saved_cover_path = os.path.join(SONGS_DIR, f"{base_name}_cover.{ext}")
                with open(saved_cover_path, 'wb') as f: f.write(cover_data)
                cover_path = utils.to_web_path(saved_cover_path)
        except Exception as e:
            logger.error(f"Error processing metadata for {filepath}: {e}")
            if not name:
                parsed_artist, parsed_name = utils.parse_artist_title(os.path.basename(filepath))
                name, artist = parsed_name, parsed_artist
        return {'name': name, 'artist': artist, 'cover_path': cover_path}
    def write_metadata_to_file(self, web_path, details):
        filepath = utils.web_to_os_path(web_path)
        audio = mutagen.File(filepath, easy=True)
        if not audio: return
        if details.get('name'): audio['title'] = details['name']
        if details.get('artist'): audio['artist'] = details['artist']
        audio.save()
    def embed_cover_in_file(self, web_audio_path, web_cover_path):
        audio_path, cover_path = utils.web_to_os_path(web_audio_path), utils.web_to_os_path(web_cover_path)
        with open(cover_path, 'rb') as f: cover_data = f.read()
        mime_type = 'image/jpeg' if cover_path.lower().endswith(('.jpg', '.jpeg')) else 'image/png'
        audio = mutagen.File(audio_path)
        if not audio: return
        if isinstance(audio, MP3):
            audio = MP3(audio_path)
            audio.tags.add(APIC(encoding=3, mime=mime_type, type=3, desc=u'Cover', data=cover_data))
        elif isinstance(audio, FLAC):
            pic = mutagen.flac.Picture()
            pic.data, pic.mime, pic.type = cover_data, mime_type, 3
            audio.clear_pictures()
            audio.add_picture(pic)
        elif isinstance(audio, M4A):
            fmt = MP4Cover.FORMAT_JPEG if mime_type == 'image/jpeg' else MP4Cover.FORMAT_PNG
            audio['covr'] = [MP4Cover(cover_data, imageformat=fmt)]
        audio.save()
    def generate_accent_color(self, cover_os_path):
        try:
            with Image.open(cover_os_path) as img:
                pixels_rgb = np.array(img.resize((64, 64), Image.Resampling.LANCZOS).convert("RGB"), dtype=np.float32) / 255.0
            pixels_rgb = pixels_rgb.reshape(-1, 3)
            pixels_hsv = _vectorized_rgb_to_hsv(pixels_rgb)
            h, s, v = pixels_hsv[:, 0], pixels_hsv[:, 1], pixels_hsv[:, 2]
            saturation_mask = s > 0.20
            weights = s * np.maximum(0, 1 - np.abs(v - 0.75) * 2)
            weights[~saturation_mask] = 0
            hue_indices = (h * 36).astype(int) % 36
            if np.isclose(np.sum(weights), 0):
                luminance = np.dot(pixels_rgb, [0.2126, 0.7152, 0.0722])
                c = 200 if np.mean(luminance) * 255 < 100 else 80
                return {'r': c, 'g': c, 'b': c}
            hue_bin_weights = np.bincount(hue_indices, weights=weights, minlength=36)
            s_in_bins = np.bincount(hue_indices, weights=s * weights, minlength=36)
            v_in_bins = np.bincount(hue_indices, weights=v * weights, minlength=36)
            dominant_hue_index = np.argmax(hue_bin_weights)
            dominant_bin_weight = hue_bin_weights[dominant_hue_index]
            avg_s, avg_v = s_in_bins[dominant_hue_index] / dominant_bin_weight, v_in_bins[dominant_hue_index] / dominant_bin_weight
            final_s, final_v = min(1.0, avg_s * 1.2), min(1.0, max(0.6, avg_v))
            dominant_hue_deg = (dominant_hue_index / 36.0) * 360.0
            r, g, b = colorsys.hsv_to_rgb(dominant_hue_deg / 360.0, final_s, final_v)
            return {'r': int(r*255), 'g': int(g*255), 'b': int(b*255)}
        except Exception as e:
            logger.error(f"Error generating accent color for {cover_os_path}: {e}")
            return {'r': 150, 'g': 150, 'b': 150}
    def get_cover_data(self, cover_os_path):
        if not cover_os_path or not os.path.exists(cover_os_path): return None
        image_format = os.path.splitext(cover_os_path)[1].lstrip('.').lower()
        if image_format == 'jpg': image_format = 'jpeg'
        with open(cover_os_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            return f"data:image/{image_format};base64,{encoded_string}"
    def get_import_candidates_from_files(self, file_paths):
        all_candidates, titles_to_check = [], []
        for src_path in file_paths:
            metadata = self._extract_metadata_from_file(src_path)
            title = metadata.get('name') or os.path.splitext(os.path.basename(src_path))[0]
            all_candidates.append({'source_path': src_path, 'title': title, 'artist': metadata.get('artist'), 'is_duplicate': False})
            if title: titles_to_check.append(title)
        if titles_to_check:
            existing_titles_set = self.db_handler.get_existing_titles(titles_to_check)
            for candidate in all_candidates:
                if candidate['title'] and candidate['title'].lower() in existing_titles_set:
                    candidate['is_duplicate'] = True
        return all_candidates
    def finalize_import_from_files(self, file_paths):
        newly_added_songs = []
        for src_path in file_paths:
            filename = os.path.basename(src_path)
            count, final_filename, dest_os_path = 1, filename, os.path.join(SONGS_DIR, filename)
            while os.path.exists(dest_os_path):
                base, ext = os.path.splitext(filename)
                final_filename = f"{base}_{count}{ext}"
                dest_os_path = os.path.join(SONGS_DIR, final_filename)
                count += 1
            shutil.copy2(src_path, dest_os_path)
            metadata = self._extract_metadata_from_file(dest_os_path)
            song_obj = {"name": metadata['name'], "artist": metadata['artist'], "path": utils.to_web_path(dest_os_path), "coverPath": metadata['cover_path'], "isMissing": False, "tagIds": []}
            newly_added_songs.append(song_obj)
        return newly_added_songs
    def _parse_ydl_error(self, error_string):
        err_lower = error_string.lower()
        if 'unsupported url' in err_lower: return "The provided URL is not supported."
        if 'unavailable' in err_lower: return "This video is unavailable."
        if 'private' in err_lower: return "This video is private."
        if 'age-restricted' in err_lower: return "This video is age-restricted."
        if 'no such file or directory' in err_lower and 'ffmpeg' in err_lower: return "FFmpeg is not installed or not in PATH."
        return error_string.split('ERROR:')[-1].strip()
    def fetch_url_metadata(self, url):
        if not os.path.exists(self.yt_dlp_path): return {'status': 'error', 'message': 'yt-dlp is not installed. Please update it in Settings.'}
        try:
            command = [self.yt_dlp_path, '--flat-playlist', '--ignore-errors', '--dump-json', url]
            result = subprocess.run(command, capture_output=True, text=True, check=True, encoding='utf-8')
            lines, first_info = result.stdout.strip().split('\n'), json.loads(result.stdout.strip().split('\n')[0])
            entries = [json.loads(line) for line in lines] if 'entries' in first_info else [first_info]
            playlist_title = first_info.get('title', 'Playlist' if 'entries' in first_info else 'Single Video')
            all_titles = [entry.get('title', 'Untitled') for entry in entries]
            existing_titles_set = self.db_handler.get_existing_titles(all_titles)
            valid_entries = []
            for entry in entries:
                title = entry.get('title', 'Untitled')
                is_unavailable = title in ('[Deleted video]', '[Private video]')
                valid_entries.append({'title': title, 'is_duplicate': (title.lower() in existing_titles_set) and not is_unavailable, 'is_unavailable': is_unavailable})
            if not valid_entries: return {'status': 'error', 'message': 'No valid videos found.'}
            return {'status': 'success', 'playlist_title': playlist_title, 'entries': valid_entries}
        except subprocess.CalledProcessError as e: return {'status': 'error', 'message': self._parse_ydl_error(e.stderr or e.stdout)}
        except Exception as e: return {'status': 'error', 'message': self._parse_ydl_error(str(e))}
    @contextmanager
    def download_single_from_url(self, url):
        if not os.path.exists(self.yt_dlp_path): raise Exception("yt-dlp is not installed. Please update it in Settings.")
        with tempfile.TemporaryDirectory() as temp_dir:
            command = [
                self.yt_dlp_path, '--format', 'bestaudio/best', 
                '-o', os.path.join(temp_dir, '%(title)s.%(ext)s'), 
                '--extract-audio', '--audio-format', 'mp3', 
                '--audio-quality', '192K', '--write-thumbnail', 
                '--no-playlist', '--ignore-errors'
            ]
            if self.has_ffmpeg:
                command.extend(['--ffmpeg-location', self.ffmpeg_path])
            
            command.append(url)

            try:
                subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
                yield temp_dir
            except subprocess.CalledProcessError as e: raise Exception(self._parse_ydl_error(e.stderr or e.stdout)) from e
    def get_ydl_info(self, url, temp_dir):
        downloaded_files = [f for f in os.listdir(temp_dir) if f.endswith('.mp3')]
        if not downloaded_files: raise Exception("No MP3 file found in download directory.")
        temp_audio_path = os.path.join(temp_dir, downloaded_files[0])
        command = [self.yt_dlp_path, '--skip-download', '--dump-json', url]
        result = subprocess.run(command, capture_output=True, text=True, check=True, encoding='utf-8')
        info_dict = json.loads(result.stdout)
        info_dict['requested_downloads'] = [{'filepath': temp_audio_path}]
        return info_dict
    def _process_ydl_entry(self, entry_info, temp_dir):
        if not entry_info or 'requested_downloads' not in entry_info or not entry_info['requested_downloads']: return None
        temp_audio_path = entry_info['requested_downloads'][0]['filepath']
        if not os.path.exists(temp_audio_path): return None
        original_filename = os.path.basename(temp_audio_path)
        base, ext = os.path.splitext(original_filename)
        final_filename, dest_os_path, count = original_filename, os.path.join(SONGS_DIR, original_filename), 1
        while os.path.exists(dest_os_path):
            final_filename = f"{base}_{count}{ext}"
            dest_os_path = os.path.join(SONGS_DIR, final_filename)
            count += 1
        shutil.move(temp_audio_path, dest_os_path)
        web_audio_path = utils.to_web_path(dest_os_path)
        song_name, song_artist = entry_info.get('title'), entry_info.get('artist') or entry_info.get('uploader')
        temp_audio_basename, _ = os.path.splitext(os.path.basename(temp_audio_path))
        temp_cover_path = next((os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.startswith(temp_audio_basename) and f.lower().endswith(('.webp', '.jpg', '.jpeg', '.png'))), None)
        web_cover_path = None
        if temp_cover_path:
            final_audio_basename, cover_ext = os.path.splitext(final_filename)[0], os.path.splitext(temp_cover_path)[1]
            new_cover_filename = f"{final_audio_basename}_cover{cover_ext}"
            dest_cover_os_path = os.path.join(SONGS_DIR, new_cover_filename)
            shutil.move(temp_cover_path, dest_cover_os_path)
            web_cover_path = utils.to_web_path(dest_cover_os_path)
        try:
            self.write_metadata_to_file(web_audio_path, {'name': song_name, 'artist': song_artist})
            if web_cover_path: self.embed_cover_in_file(web_audio_path, web_cover_path)
        except Exception as e: logger.error(f"Could not write metadata for downloaded file {dest_os_path}: {e}")
        return {"name": song_name, "artist": song_artist, "path": web_audio_path, "coverPath": web_cover_path, "isMissing": False, "tagIds": []}
    def delete_files(self, file_paths):
        for file_path in file_paths:
            if file_path and os.path.exists(file_path):
                try: os.remove(file_path)
                except OSError as e: logger.error(f"Could not remove file {file_path}: {e}")
    def show_in_explorer(self, web_path):
        os_path = utils.web_to_os_path(web_path)
        if not os.path.exists(os_path): return {'status': 'error', 'message': 'File not found.'}
        absolute_path = os.path.abspath(os_path)
        if sys.platform == "win32": subprocess.Popen(['explorer', '/select,', absolute_path])
        elif sys.platform == "darwin": subprocess.Popen(['open', '-R', absolute_path])
        else: subprocess.Popen(['xdg-open', os.path.dirname(absolute_path)])
        return {'status': 'success'}
    def open_external_link(self, url): webbrowser.open(url)
    def export_playlist(self, playlist_name, save_path):
        export_data = self.db_handler.get_playlist_data_for_export(playlist_name)
        with tempfile.TemporaryDirectory() as temp_dir:
            with open(os.path.join(temp_dir, 'playlist_data.json'), 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=4)
            for song in export_data['songs']:
                if song.get('path'):
                    src_song_path = utils.web_to_os_path(song['path'])
                    if os.path.exists(src_song_path): shutil.copy2(src_song_path, os.path.join(temp_dir, os.path.basename(src_song_path)))
                if song.get('coverPath'):
                    src_cover_path = utils.web_to_os_path(song['coverPath'])
                    if os.path.exists(src_cover_path): shutil.copy2(src_cover_path, os.path.join(temp_dir, os.path.basename(src_cover_path)))
            archive_base_path = os.path.splitext(save_path)[0]
            shutil.make_archive(archive_base_path, 'zip', temp_dir)
            if os.path.exists(save_path): os.remove(save_path)
            shutil.move(f'{archive_base_path}.zip', save_path)
    def export_playlist_as_m3u(self, playlist_name, save_path):
        song_web_paths = self.db_handler.get_song_paths_for_playlist(playlist_name)
        absolute_os_paths = [os.path.abspath(utils.web_to_os_path(p)) for p in song_web_paths]
        with open(save_path, 'w', encoding='utf-8') as f:
            f.write("#EXTM3U\n")
            for path in absolute_os_paths: f.write(path + "\n")
    def import_playlist(self, fnlist_path):
        if not zipfile.is_zipfile(fnlist_path): raise ValueError("Invalid file format. Not a .fnlist archive.")
        with tempfile.TemporaryDirectory() as temp_dir:
            with zipfile.ZipFile(fnlist_path, 'r') as archive:
                if 'playlist_data.json' not in archive.namelist(): raise ValueError("Invalid archive. 'playlist_data.json' manifest not found.")
                archive.extractall(temp_dir)
            with open(os.path.join(temp_dir, 'playlist_data.json'), 'r', encoding='utf-8') as f: manifest = json.load(f)
            all_playlist_names = self.db_handler.get_all_playlist_names()
            original_playlist_name = manifest['name']
            final_playlist_name = original_playlist_name
            count = 1
            while final_playlist_name in all_playlist_names:
                final_playlist_name = f"{original_playlist_name} ({count})"
                count += 1
            all_song_files = os.listdir(SONGS_DIR)
            for song in manifest['songs']:
                original_song_filename, final_song_filename, count = os.path.basename(song['path']), os.path.basename(song['path']), 1
                while final_song_filename in all_song_files:
                    base, ext = os.path.splitext(original_song_filename)
                    final_song_filename = f"{base}_{count}{ext}"
                    count += 1
                shutil.copy2(os.path.join(temp_dir, original_song_filename), os.path.join(SONGS_DIR, final_song_filename))
                song['path'] = utils.to_web_path(os.path.join(SONGS_DIR, final_song_filename))
                if song.get('coverPath'):
                    original_cover_filename, final_cover_filename, count = os.path.basename(song['coverPath']), os.path.basename(song['coverPath']), 1
                    while final_cover_filename in all_song_files:
                        base, ext = os.path.splitext(original_cover_filename)
                        final_cover_filename = f"{base}_{count}{ext}"
                        count += 1
                    shutil.copy2(os.path.join(temp_dir, original_cover_filename), os.path.join(SONGS_DIR, final_cover_filename))
                    song['coverPath'] = utils.to_web_path(os.path.join(SONGS_DIR, final_cover_filename))
            new_playlist = self.db_handler.import_playlist_from_data(manifest, final_playlist_name)
            return new_playlist

    # --- DOWNLOAD WORKER (MOVED FROM song_api.py) ---
    def _background_download_worker(self, entries_to_download, url_for_fallback):
        newly_added_songs, total = [], len(entries_to_download)
        for i, entry in enumerate(entries_to_download):
            entry_id = str(entry.get('id', f"item_{i}")).replace("'", "").replace('"', "")
            entry_title = entry.get('title', 'Untitled')
            entry_url = entry.get('webpage_url', entry.get('url', url_for_fallback))
            try:
                self.window_manager.broadcast_js(f"window.progress_update('{entry_id}', 'working', 'Downloading...', {i + 1}, {total})")
                with self.download_single_from_url(entry_url) as temp_dir:
                    info_dict = self.get_ydl_info(entry_url, temp_dir)
                    processed_song = self._process_ydl_entry(info_dict, temp_dir)
                    if processed_song:
                        newly_added_songs.append(processed_song)
                        self.window_manager.broadcast_js(f"window.progress_update('{entry_id}', 'success', 'Done', {i + 1}, {total})")
                    else: raise Exception("File processing failed after download.")
            except Exception as e:
                error_message = str(e).replace("'", "\\'").replace('"', '\\"')
                self.window_manager.broadcast_js(f"window.progress_update('{entry_id}', 'error', '{error_message}', {i + 1}, {total})")
        return newly_added_songs
    def _on_url_download_complete(self, future):
        try:
            newly_added = future.result()
            if newly_added:
                self.window_manager.broadcast_js(f"window.completeUrlDownload({json.dumps({'status': 'success', 'songs': newly_added})})")
                self.window_manager.broadcast_js(f"window.progress_finish('Download complete. {len(newly_added)} song(s) added.', false)")
            else: self.window_manager.broadcast_js("window.progress_finish('Download finished. No new songs were added.', false, true)")
        except Exception as e:
            error_message = str(e).replace("'", "\\'").replace('"', '\\"')
            self.window_manager.broadcast_js(f"window.progress_finish('Download failed: {error_message}', true)")
        finally:
            self.active_task_name = None
            self.long_task_lock.release()
    def start_url_download(self, url, indices=None):
        if not self.long_task_lock.acquire(blocking=False): return {'status': 'error', 'message': f'Another task ({self.active_task_name}) is already in progress.'}
        try:
            command = [self.yt_dlp_path, '--flat-playlist', '--ignore-errors', '--dump-json', url]
            result = subprocess.run(command, capture_output=True, text=True, check=True, encoding='utf-8')
            lines, info = result.stdout.strip().split('\n'), json.loads(result.stdout.strip().split('\n')[0])
            all_entries = [json.loads(line) for line in lines] if 'entries' in info else [info]
            entries_to_download = [all_entries[i-1] for i in indices if 0 < i <= len(all_entries)] if indices else all_entries
            if not entries_to_download:
                self.long_task_lock.release()
                return {'status': 'error', 'message': 'No items selected for download.'}
            progress_items = [{'id': str(entry.get('id', f'item_{i}')).replace("'", "").replace('"', ""), 'name': entry.get('title', 'Untitled')} for i, entry in enumerate(entries_to_download)]
            title = f"Downloading from {info.get('title', 'URL')}"
            self.window_manager.broadcast_js(f"window.progress_start({json.dumps(title)}, {json.dumps(progress_items)})")
            self.active_task_name = f"Downloading from {info.get('title', 'URL')}"
            future = self.executor.submit(self._background_download_worker, entries_to_download, url)
            future.add_done_callback(self._on_url_download_complete)
            return {'status': 'processing'}
        except Exception as e:
            self.active_task_name = None
            self.long_task_lock.release()
            return {'status': 'error', 'message': str(e)}

    # --- REFRESH ACCENTS WORKER (MOVED FROM song_api.py) ---
    def _background_refresh_accents(self):
        try:
            all_songs_with_covers = self.db_handler.get_all_songs_with_covers()
            total = len(all_songs_with_covers)
            if total == 0:
                self.window_manager.broadcast_js("window.completeAccentRefresh('No songs with covers to refresh.', false)")
                return
            progress_items = [{'id': song['path'], 'name': os.path.basename(song['path'])} for song in all_songs_with_covers]
            self.window_manager.broadcast_js(f"window.progress_start('Refreshing Accent Colors', {json.dumps(progress_items)})")
            for i, song in enumerate(all_songs_with_covers):
                song_path = song['path'].replace("'", "\\'")
                try:
                    self.window_manager.broadcast_js(f"window.progress_update('{song_path}', 'working', '', {i + 1}, {total})")
                    new_color = self.generate_accent_color(utils.web_to_os_path(song['cover_path']))
                    if new_color:
                        self.db_handler.save_song_color(song['path'], new_color)
                        self.window_manager.broadcast_js(f"window.updateSongAccentColor({json.dumps(song['path'])}, {json.dumps(new_color)})")
                    self.window_manager.broadcast_js(f"window.progress_update('{song_path}', 'success', 'Done', {i + 1}, {total})")
                except Exception as e:
                    error_msg = str(e).replace("'", "\\'").replace('"', '\\"')
                    self.window_manager.broadcast_js(f"window.progress_update('{song_path}', 'error', '{error_msg}', {i + 1}, {total})")
            self.window_manager.broadcast_js("window.completeAccentRefresh('Accent refresh complete!', false)")
        except Exception as e:
            error_message = json.dumps(f"An error occurred: {e}")
            self.window_manager.broadcast_js(f"window.completeAccentRefresh({error_message}, true)")
        finally:
            self.active_task_name = None
            self.long_task_lock.release()
    def refresh_all_accent_colors(self):
        if not self.long_task_lock.acquire(blocking=False): return {'status': 'error', 'message': f'Another task ({self.active_task_name}) is already in progress.'}
        self.active_task_name = "Refreshing Accent Colors"
        self.executor.submit(self._background_refresh_accents)
        return {'status': 'processing'}