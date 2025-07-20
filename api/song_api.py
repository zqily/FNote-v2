import os
import json
import shutil
import logging
import base64
import mimetypes

import python_utils as utils

logger = logging.getLogger(__name__)

class SongApi:
    def __init__(self, db_handler, media_manager, executor, window_manager):
        self.db = db_handler
        self.media = media_manager
        self.executor = executor
        self.window_manager = window_manager

    def get_song_data_uri(self, web_path):
        """
        Reads a song file and returns its content as a Base64-encoded data URI.
        """
        try:
            os_path = utils.web_to_os_path(web_path)
            if not os_path or not os.path.exists(os_path):
                logger.warning(f"Data URI requested for non-existent file: {web_path}")
                return None
            
            mime_type, _ = mimetypes.guess_type(os_path)
            if mime_type is None:
                mime_type = 'application/octet-stream' # Fallback
            
            with open(os_path, "rb") as f:
                encoded_string = base64.b64encode(f.read()).decode('utf-8')
            
            logger.info(f"Generated data URI for {os_path}")
            return f"data:{mime_type};base64,{encoded_string}"
        except Exception as e:
            logger.error(f"Error creating data URI for {web_path}: {e}", exc_info=True)
            return None

    def get_songs_by_paths(self, paths):
        """Fetches full song data for a list of paths."""
        try:
            return self.db.get_songs_by_paths(paths)
        except Exception as e:
            logger.error("Error in get_songs_by_paths: %s", e, exc_info=True)
            raise e

    def search_all_songs(self, query):
        """Searches all songs in the library based on a text and/or tag query."""
        if not query or not query.strip():
            return {'songs': [], 'suggestions': []}
        try:
            parsed_query = utils.parse_search_query(query)
            return self.db.search_all_songs(parsed_query['text'], parsed_query['tags'])
        except Exception as e:
            logger.error("Error in search_all_songs for query '%s': %s", query, e, exc_info=True)
            raise e

    def search_in_playlist(self, playlist_name, query):
        """Searches for songs within a specific playlist."""
        if not query or not query.strip():
            return {'songs': [], 'suggestions': []}
        try:
            parsed_query = utils.parse_search_query(query)
            return self.db.search_in_playlist(playlist_name, parsed_query['text'], parsed_query['tags'])
        except Exception as e:
            logger.error("Error in search_in_playlist for query '%s' in playlist '%s': %s", query, playlist_name, e, exc_info=True)
            raise e
            
    def import_from_files(self):
        """
        Opens a file dialog, gets metadata and duplicate status for selected files,
        and returns a list of candidates for the user to review.
        """
        import webview
        try:
            file_types = ('Media Files (*.mp3;*.wav;*.flac;*.m4a;*.ogg;*.opus;*.mp4;*.mkv;*.webm;*.mov;*.avi)', 'All files (*.*)')
            source_paths = self.window_manager.windows['main'].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=file_types)
            if not source_paths:
                logger.info("File import dialog cancelled by user.")
                return {'status': 'cancelled'}
            
            logger.info(f"User selected {len(source_paths)} file(s) for import.")
            candidates = self.media.get_import_candidates_from_files(source_paths)
            return {'status': 'success', 'entries': candidates}

        except Exception as e:
            logger.error("Error during file import dialog: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def finalize_file_import(self, source_paths):
        """
        Finalizes the import of files after user confirmation.
        This is called by the frontend if import_from_files returned 'confirmation_required'.
        """
        try:
            if not source_paths:
                return {'status': 'error', 'message': 'No file paths provided to import.'}
            logger.info(f"Finalizing import of {len(source_paths)} file(s).")
            new_songs = self.media.finalize_import_from_files(source_paths)
            logger.info(f"Successfully imported {len(new_songs)} new song(s).")
            return {'status': 'success', 'songs': new_songs}
        except Exception as e:
            logger.error("Error finalizing file import: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def fetch_url_metadata(self, url):
        """Fetches metadata for a given URL (e.g., YouTube) without downloading."""
        logger.info(f"Fetching URL metadata for: {url}")
        return self.media.fetch_url_metadata(url)

    def start_url_download(self, url, indices=None):
        """Delegates the start of a URL download to the MediaManager."""
        return self.media.start_url_download(url, indices)

    def get_cover_data(self, web_path):
        """Gets the base64-encoded data URI for a song's cover image."""
        try:
            cover_web_path = self.db.get_cover_path_for_song(web_path)
            if not cover_web_path: return None
            return self.media.get_cover_data(utils.web_to_os_path(cover_web_path))
        except Exception as e:
            logger.error("Error getting cover data for '%s': %s", web_path, e, exc_info=True)
            return None
    
    def _on_color_generated(self, song_web_path, future):
        """Callback executed when accent color generation is done."""
        try:
            color = future.result()
            if color:
                self.db.save_song_color(song_web_path, color)
                safe_path, safe_color = json.dumps(song_web_path), json.dumps(color)
                self.window_manager.broadcast_js(f"window.updateSongAccentColor({safe_path}, {safe_color})")
        except Exception as e:
            logger.error(f"Error in color generation callback for {song_web_path}: {e}", exc_info=True)

    def generate_accent_color(self, web_path):
        """Generates a dominant color from a song's cover art in the background."""
        cover_web_path = self.db.get_cover_path_for_song(web_path)
        if not cover_web_path: return
        cover_os_path = utils.web_to_os_path(cover_web_path)
        future = self.executor.submit(self.media.generate_accent_color, cover_os_path)
        future.add_done_callback(lambda f: self._on_color_generated(web_path, f))

    def refresh_all_accent_colors(self):
        """Kicks off a background task to recalculate all accent colors."""
        return self.media.refresh_all_accent_colors()

    def save_song_color(self, path, color):
        """Saves a pre-calculated accent color for a song to the database."""
        try:
            self.db.save_song_color(path, color)
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error saving song color for '{path}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def change_song_cover(self, web_path):
        """Opens a file dialog to select a new cover for a song."""
        import webview
        file_types = ('Image Files (*.jpg;*.jpeg;*.png;*.webp)',)
        new_cover_paths = self.window_manager.windows['main'].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)
        if not new_cover_paths:
            logger.info("Change song cover dialog cancelled by user.")
            return {'status': 'cancelled'}
        
        try:
            new_cover_src_path = new_cover_paths[0]
            logger.info(f"Changing cover for '{web_path}' with new file '{new_cover_src_path}'.")
            old_cover_web_path = self.db.get_cover_path_for_song(web_path)
            if old_cover_web_path: self.media.delete_files([utils.web_to_os_path(old_cover_web_path)])
            base_name, _ = os.path.splitext(os.path.basename(utils.web_to_os_path(web_path)))
            _, new_ext = os.path.splitext(new_cover_src_path)
            new_cover_filename = f"{base_name}_cover{new_ext}"
            new_cover_dest_os_path = os.path.join(self.media.SONGS_DIR, new_cover_filename)
            shutil.copy2(new_cover_src_path, new_cover_dest_os_path)
            new_cover_web_path = utils.to_web_path(new_cover_dest_os_path)
            self.db.change_song_cover_in_db(web_path, new_cover_web_path)
            self.media.embed_cover_in_file(web_path, new_cover_web_path)
            coverData = self.media.get_cover_data(new_cover_dest_os_path)
            logger.info(f"Successfully changed cover for '{web_path}'.")
            return {'status': 'success', 'songUpdate': {'coverPath': new_cover_web_path, 'coverData': coverData}}
        except Exception as e:
            logger.error(f"Error changing song cover for '{web_path}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def delete_songs(self, web_paths):
        """Deletes songs from the database and their associated files."""
        try:
            logger.info(f"Deleting {len(web_paths)} song(s).")
            files_to_delete = self.db.delete_songs(web_paths)
            self.media.delete_files(files_to_delete)
            logger.info(f"Successfully deleted songs and {len(files_to_delete)} associated file(s).")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error deleting songs: {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}
        
    def save_markers(self, path, markers):
        """Saves playback markers for a song."""
        try:
            self.db.save_markers(path, markers)
            logger.info(f"Saved {len(markers)} marker(s) for song '{path}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error saving markers for '{path}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def update_song_details(self, paths, details):
        """Updates details for one or more songs (name, artist, tags) in the database and optionally in the file."""
        try:
            logger.info(f"Updating details for {len(paths)} song(s) with data: {details}")
            updated_songs = self.db.update_song_details(paths, details)
            if details.get('saveToFile', False):
                logger.info("Saving metadata to audio file tags.")
                file_metadata_to_write = {k: v for k, v in details.items() if k in ['name', 'artist']}
                if file_metadata_to_write:
                    for path in paths:
                        self.media.write_metadata_to_file(path, file_metadata_to_write)
            return updated_songs
        except Exception as e:
            logger.error(f"Error updating song details: {e}", exc_info=True)
            raise e