import traceback
from sqlite3 import IntegrityError
import logging

logger = logging.getLogger(__name__)

class PlaylistApi:
    def __init__(self, db_handler, media_manager, window_manager):
        self.db = db_handler
        self.media = media_manager
        self.windows = window_manager.windows

    def add_songs_to_playlist(self, playlist_name, songs):
        """Adds a list of songs to a specified playlist."""
        try:
            self.db.add_songs_to_playlist(playlist_name, songs)
            logger.info(f"Added {len(songs)} song(s) to playlist '{playlist_name}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error adding songs to playlist '{playlist_name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def reorder_playlist_songs(self, playlist_name, song_path_order):
        """Updates the order of songs within a playlist based on a new list of paths."""
        try:
            self.db.reorder_playlist_songs(playlist_name, song_path_order)
            logger.info(f"Reordered songs in playlist '{playlist_name}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error reordering songs in playlist '{playlist_name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def reorder_playlists(self, order):
        """Updates the display order of the playlists."""
        try:
            self.db.reorder_playlists(order)
            logger.info(f"Playlist order updated to: {order}")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error reordering playlists: {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def move_songs_to_playlist(self, source, target, paths):
        """Moves a list of songs from a source playlist to a target playlist."""
        try:
            self.db.move_songs_to_playlist(source, target, paths)
            logger.info(f"Moved {len(paths)} song(s) from '{source}' to '{target}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error moving songs from '{source}' to '{target}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def rename_playlist(self, old_name, new_name):
        """Renames a playlist."""
        try:
            self.db.rename_playlist(old_name, new_name)
            logger.info(f"Renamed playlist from '{old_name}' to '{new_name}'.")
            return {'status': 'success'}
        except IntegrityError as e:
            logger.warning(f"Failed to rename playlist to '{new_name}': name already exists.")
            return {'status': 'error', 'message': f'Playlist name "{new_name}" already exists.'}
        except Exception as e:
            logger.error(f"Error renaming playlist '{old_name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def delete_playlist(self, name):
        """Deletes a playlist and any songs that become orphaned as a result."""
        try:
            files_to_delete = self.db.delete_playlist(name)
            self.media.delete_files(files_to_delete)
            logger.info(f"Deleted playlist '{name}' and {len(files_to_delete)} associated file(s).")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error deleting playlist '{name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def export_playlist(self, playlist_name):
        """Exports a playlist and its songs to a .fnlist file."""
        import webview
        try:
            file_types = ('FNote Playlist (*.fnlist)',)
            save_path = self.windows['main'].create_file_dialog(webview.SAVE_DIALOG, file_types=file_types, save_filename=f'{playlist_name}.fnlist')
            if not save_path:
                logger.info("Playlist export cancelled by user.")
                return {'status': 'cancelled'}
            
            if not save_path.endswith('.fnlist'):
                save_path += '.fnlist'

            self.media.export_playlist(playlist_name, save_path)
            logger.info(f"Exported playlist '{playlist_name}' to '{save_path}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error exporting playlist '{playlist_name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def export_playlist_as_m3u(self, playlist_name):
        """Exports a playlist to a .m3u file."""
        import webview
        try:
            file_types = ('M3U Playlist (*.m3u;*.m3u8)',)
            save_path = self.windows['main'].create_file_dialog(webview.SAVE_DIALOG, file_types=file_types, save_filename=f'{playlist_name}.m3u')
            if not save_path:
                logger.info("M3U export cancelled by user.")
                return {'status': 'cancelled'}

            if not save_path.lower().endswith(('.m3u', '.m3u8')):
                save_path += '.m3u'

            self.media.export_playlist_as_m3u(playlist_name, save_path)
            logger.info(f"Exported playlist '{playlist_name}' as M3U to '{save_path}'.")
            return {'status': 'success'}
        except Exception as e:
            logger.error(f"Error exporting playlist '{playlist_name}' as M3U: {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def import_playlist(self, fnlist_path=None):
        """Imports a playlist from a .fnlist file. Can take an optional path."""
        import webview
        import os
        try:
            if not fnlist_path:
                file_types = ('FNote Playlist (*.fnlist)', 'All files (*.*)')
                file_paths = self.windows['main'].create_file_dialog(webview.OPEN_DIALOG, file_types=file_types, allow_multiple=False)
                if not file_paths:
                    logger.info("Playlist import cancelled by user.")
                    return {'status': 'cancelled'}
                fnlist_path = file_paths[0]
            
            if not os.path.exists(fnlist_path):
                logger.error(f"Playlist import failed: file not found at '{fnlist_path}'.")
                return {'status': 'error', 'message': f'File not found: {fnlist_path}'}

            newly_imported_playlist = self.media.import_playlist(fnlist_path)
            logger.info(f"Successfully imported playlist '{newly_imported_playlist['name']}' from '{fnlist_path}'.")
            return {'status': 'success', 'playlist': newly_imported_playlist}
        except Exception as e:
            logger.error(f"Error importing playlist from '{fnlist_path}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}