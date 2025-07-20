import sqlite3
import os
from contextlib import contextmanager
import logging

import python_utils as utils
from python_utils import APP_DATA_DIR

logger = logging.getLogger(__name__)
DATABASE_FILE = os.path.join(APP_DATA_DIR, 'FNote.db')
DEFAULT_TAGS = {
    "Genre": ["Lo-fi / Chillhop", "Electronic", "Cinematic", "Ambient", "Acoustic", "Corporate", "8-bit / Chiptune", "Funk", "Orchestral", "Synthwave", "Phonk", "Hip Hop", "Pop", "Rock", "Jazz", "Folk", "EDM", "Indie", "R&B / Soul"],
    "Mood/Vibe": ["Uplifting", "Energetic", "Calm / Relaxing", "Epic / Dramatic", "Happy / Cheerful", "Serious / Focused", "Mysterious", "Nostalgic", "Funny / Quirky", "Inspirational", "Suspenseful", "Reflective / Pensive", "Driving / Pumping", "Dreamy / Ethereal", "Playful", "Cool / Smooth"],
    "Use Case": ["Intro / Opener", "Outro / Closer", "Background Music", "Montage", "Vlog Music", "Tutorial", "Livestreaming", "Time-lapse", "Gaming", "Ad / Commercial", "Podcast", "Documentary", "Explainer Video", "Presentation", "Workout", "Travel Video", "Product Demo", "Storytelling"]
}

class DatabaseHandler:
    """Handles all interactions with the SQLite database."""

    @contextmanager
    def _get_db_conn(self):
        """Provides a database connection as a context manager."""
        conn = None
        try:
            conn = sqlite3.connect(DATABASE_FILE, timeout=10)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON;")
            yield conn
        except sqlite3.Error as e:
            logger.error(f"Database error: {e}", exc_info=True)
            raise
        finally:
            if conn:
                conn.close()

    def init_database(self):
        """Initializes the database, creating tables and default tags if they don't exist."""
        logger.info("Initializing database...")
        with self._get_db_conn() as conn:
            cursor = conn.cursor()
            self._create_tables(cursor)
            self._populate_default_tags(cursor)
            conn.commit()
        logger.info("Database initialization complete.")

    def _create_tables(self, c):
        """Creates all necessary tables for the application."""
        c.execute("CREATE TABLE IF NOT EXISTS songs (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT, artist TEXT, cover_path TEXT, accent_color_r INTEGER, accent_color_g INTEGER, accent_color_b INTEGER)")
        c.execute("CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, order_index INTEGER)")
        c.execute("CREATE TABLE IF NOT EXISTS playlist_songs (playlist_id INTEGER NOT NULL, song_id INTEGER NOT NULL, song_order_index INTEGER NOT NULL, PRIMARY KEY (playlist_id, song_id), FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE, FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE)")
        c.execute("CREATE TABLE IF NOT EXISTS markers (id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL, timestamp REAL NOT NULL, FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE)")
        c.execute("CREATE TABLE IF NOT EXISTS tag_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)")
        c.execute("CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, UNIQUE(name, category_id), FOREIGN KEY (category_id) REFERENCES tag_categories(id) ON DELETE CASCADE)")
        c.execute("CREATE TABLE IF NOT EXISTS song_tags (song_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (song_id, tag_id), FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_songs_path ON songs (path)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_markers_song_id ON markers (song_id)")

        # FTS5 Virtual Table for full-text search on songs
        c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(name, artist, content='songs', content_rowid='id')")

        # Triggers to keep the FTS table in sync with the songs table
        c.execute("""
            CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
                INSERT INTO songs_fts(rowid, name, artist) VALUES (new.id, new.name, new.artist);
            END;
        """)
        c.execute("""
            CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
                INSERT INTO songs_fts(songs_fts, rowid, name, artist) VALUES ('delete', old.id, old.name, old.artist);
            END;
        """)
        c.execute("""
            CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE ON songs BEGIN
                INSERT INTO songs_fts(songs_fts, rowid, name, artist) VALUES ('delete', old.id, old.name, old.artist);
                INSERT INTO songs_fts(rowid, name, artist) VALUES (new.id, new.name, new.artist);
            END;
        """)
        
        # Rebuild FTS index to populate it from existing data, if any.
        # This is safe to run even if the table is empty.
        c.execute("INSERT INTO songs_fts(songs_fts) VALUES('rebuild');")

    def _populate_default_tags(self, c):
        """Populates the database with a default set of tags and categories."""
        for cat_name, tags in DEFAULT_TAGS.items():
            c.execute("INSERT OR IGNORE INTO tag_categories (name) VALUES (?)", (cat_name,))
            c.execute("SELECT id FROM tag_categories WHERE name = ?", (cat_name,))
            cat_id = c.fetchone()['id']
            c.executemany("INSERT OR IGNORE INTO tags (name, category_id, is_default) VALUES (?, ?, ?)", [(t, cat_id, 1) for t in tags])

    def _get_all_tags(self, cursor):
        """Fetches all tag categories and their associated tags."""
        cats = {r['id']: {'id': r['id'], 'name': r['name'], 'tags': []} for r in cursor.execute("SELECT id, name FROM tag_categories ORDER BY id").fetchall()}
        for tag in cursor.execute("SELECT id, name, category_id, is_default FROM tags ORDER BY name").fetchall():
            if tag['category_id'] in cats:
                cats[tag['category_id']]['tags'].append(dict(tag))
        return list(cats.values())

    def _fetch_and_format_songs_by_ids(self, c, song_ids):
        """
        Efficiently fetches and formats a list of songs given their IDs using separate queries
        to avoid row explosion from JOINs on one-to-many relationships.
        """
        if not song_ids:
            return []

        songs_map = {}
        placeholders = ','.join('?' for _ in song_ids)

        # 1. Fetch core song data
        song_query = f"""
            SELECT
                id, path, name, artist, cover_path,
                accent_color_r, accent_color_g, accent_color_b
            FROM songs
            WHERE id IN ({placeholders})
        """
        song_rows = c.execute(song_query, song_ids).fetchall()

        for row in song_rows:
            songs_map[row['id']] = {
                "path": row["path"],
                "name": row["name"],
                "artist": row["artist"],
                "coverPath": row["cover_path"],
                "isMissing": not os.path.exists(utils.web_to_os_path(row["path"])),
                "accentColor": {'r': row['accent_color_r'], 'g': row['accent_color_g'], 'b': row['accent_color_b']} if row['accent_color_r'] is not None else None,
                "markers": [],
                "tagIds": []
            }

        # 2. Fetch all markers for these songs
        marker_query = f"SELECT song_id, timestamp FROM markers WHERE song_id IN ({placeholders}) ORDER BY timestamp"
        marker_rows = c.execute(marker_query, song_ids).fetchall()
        for row in marker_rows:
            song_id = row['song_id']
            if song_id in songs_map:
                # Use a unique-enough ID for the frontend key
                marker_id = f"marker_{len(songs_map[song_id]['markers'])}_{row['timestamp']}"
                songs_map[song_id]['markers'].append({'id': marker_id, 'timestamp': row['timestamp']})

        # 3. Fetch all tag associations for these songs
        tag_query = f"SELECT song_id, tag_id FROM song_tags WHERE song_id IN ({placeholders})"
        tag_rows = c.execute(tag_query, song_ids).fetchall()
        for row in tag_rows:
            song_id = row['song_id']
            if song_id in songs_map:
                songs_map[song_id]['tagIds'].append(row['tag_id'])

        # 4. Return results in the original order of song_ids to preserve search result ranking
        return [songs_map[sid] for sid in song_ids if sid in songs_map]

    def get_initial_data(self, active_playlist_name):
        """
        Fetches all data required to initialize the frontend with a normalized state.
        Song objects are NOT included and must be fetched on-demand.
        
        Returns:
            dict: A dictionary containing 'musicData' (with songs and playlists) and 'tagData'.
        """
        with self._get_db_conn() as conn:
            c = conn.cursor()

            # Check if any playlists exist first.
            has_playlists = c.execute("SELECT 1 FROM playlists LIMIT 1").fetchone()

            # If the database is empty, create the 'Default' playlist
            if not has_playlists:
                logger.info("No playlists found. Creating 'Default' playlist.")
                c.execute("INSERT OR IGNORE INTO playlists (name, order_index) VALUES (?, ?)", ('Default', 0))
                conn.commit()
                return {
                    "musicData": {
                        "songs": {}, # Start with an empty song cache
                        "playlists": {"Default": []}, 
                        "playlistOrder": ["Default"], 
                        "activePlaylist": "Default"
                    }, 
                    "tagData": self._get_all_tags(c)
                }

            # 1. Fetch all playlist and song data in a single, ordered query to avoid N+1 problem.
            query = """
                SELECT
                    p.name as playlist_name,
                    s.path as song_path
                FROM
                    playlists p
                LEFT JOIN
                    playlist_songs ps ON p.id = ps.playlist_id
                LEFT JOIN
                    songs s ON ps.song_id = s.id
                ORDER BY
                    p.order_index, ps.song_order_index
            """
            all_relations = c.execute(query).fetchall()

            # 2. Build the playlist order and the map from the single result set.
            # This is efficient as it iterates through the results only once.
            playlist_order = []
            playlists_map = {}
            songs_map = {} # This is an empty cache for the frontend

            for row in all_relations:
                p_name = row['playlist_name']
                # Add playlist to order and map if it's the first time we've seen it.
                if p_name not in playlists_map:
                    playlists_map[p_name] = []
                    playlist_order.append(p_name)
                
                # song_path will be None for empty playlists due to LEFT JOIN, so check for it.
                if row['song_path']:
                    playlists_map[p_name].append(row['song_path'])

            # Find active playlist from config, with fallback
            if active_playlist_name not in playlist_order:
                active_playlist_name = 'Default' if 'Default' in playlist_order else playlist_order[0]
            
            data = {
                "musicData": {
                    "songs": songs_map, # This is now an empty cache
                    "playlists": playlists_map, 
                    "playlistOrder": playlist_order, 
                    "activePlaylist": active_playlist_name
                }, 
                "tagData": self._get_all_tags(c)
            }
        return data

    def get_songs_by_paths(self, web_paths):
        """Fetches full song data for a given list of web paths."""
        if not web_paths:
            return {}
        
        with self._get_db_conn() as conn:
            c = conn.cursor()
            placeholders = ','.join('?' for _ in web_paths)
            c.execute(f"SELECT id FROM songs WHERE path IN ({placeholders})", tuple(web_paths))
            song_ids = [row['id'] for row in c.fetchall()]

            if not song_ids:
                return {}

            songs_list = self._fetch_and_format_songs_by_ids(c, song_ids)
            return {song['path']: song for song in songs_list}

    def search_all_songs(self, text_query, tag_queries):
        """Performs a global search for songs and gets autocomplete suggestions."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            
            # --- Song Search Logic ---
            fts_query = f'{text_query}*' if text_query else None
            query = "SELECT s.id FROM songs s"
            params = []
            joins = []
            where_clauses = []

            if fts_query:
                joins.append("JOIN songs_fts fts ON s.id = fts.rowid")
                where_clauses.append("fts.songs_fts MATCH ?")
                params.append(fts_query)
                order_by = "ORDER BY fts.rank"
            else:
                order_by = "ORDER BY s.name"

            if tag_queries:
                joins.append("JOIN song_tags st ON s.id = st.song_id JOIN tags t ON st.tag_id = t.id")
                tag_placeholders = ','.join('?' for _ in tag_queries)
                where_clauses.append(f"LOWER(t.name) IN ({tag_placeholders})")
                params.extend([tag.lower() for tag in tag_queries])

            if joins: query += " " + " ".join(joins)
            if where_clauses: query += " WHERE " + " AND ".join(where_clauses)
            query += " GROUP BY s.id"
            if tag_queries:
                query += " HAVING COUNT(DISTINCT LOWER(t.name)) = ?"
                params.append(len(tag_queries))
            query += f" {order_by}"
            
            c.execute(query, tuple(params))
            song_ids = [row['id'] for row in c.fetchall()]
            
            # --- Autocomplete Suggestion Logic ---
            suggestions = []
            if text_query:
                sugg_fts_query = f'"{text_query}"*'
                sugg_sql = """
                    SELECT name AS suggestion FROM songs_fts WHERE name MATCH ?
                    UNION
                    SELECT artist AS suggestion FROM songs_fts WHERE artist MATCH ?
                    ORDER BY suggestion LIMIT 10
                """
                sugg_params = (sugg_fts_query, sugg_fts_query)
                suggestions = [row['suggestion'] for row in c.execute(sugg_sql, sugg_params).fetchall() if row['suggestion']]

            return {
                'songs': self._fetch_and_format_songs_by_ids(c, song_ids),
                'suggestions': suggestions
            }

    def search_in_playlist(self, playlist_name, text_query, tag_queries):
        """Performs a search for songs within a given playlist and gets autocomplete suggestions."""
        with self._get_db_conn() as conn:
            c = conn.cursor()

            c.execute("SELECT id FROM playlists WHERE name = ?", (playlist_name,))
            playlist_id_row = c.fetchone()
            if not playlist_id_row:
                return {'songs': [], 'suggestions': []}
            playlist_id = playlist_id_row['id']

            # --- Song Search Logic ---
            fts_query = f'{text_query}*' if text_query else None
            query = "SELECT s.id FROM songs s"
            params = []
            joins = ["JOIN playlist_songs ps ON s.id = ps.song_id"]
            where_clauses = ["ps.playlist_id = ?"]
            params.append(playlist_id)

            if fts_query:
                joins.append("JOIN songs_fts fts ON s.id = fts.rowid")
                where_clauses.append("fts.songs_fts MATCH ?")
                params.append(fts_query)
                order_by = "ORDER BY fts.rank"
            else:
                order_by = "ORDER BY ps.song_order_index"

            if tag_queries:
                joins.append("JOIN song_tags st ON s.id = st.song_id JOIN tags t ON st.tag_id = t.id")
                tag_placeholders = ','.join('?' for _ in tag_queries)
                where_clauses.append(f"LOWER(t.name) IN ({tag_placeholders})")
                params.extend([tag.lower() for tag in tag_queries])

            if joins: query += " " + " ".join(list(dict.fromkeys(joins)))
            if where_clauses: query += " WHERE " + " AND ".join(where_clauses)
            query += " GROUP BY s.id"
            if tag_queries:
                query += " HAVING COUNT(DISTINCT LOWER(t.name)) = ?"
                params.append(len(tag_queries))
            query += f" {order_by}"
            
            c.execute(query, tuple(params))
            song_ids = [row['id'] for row in c.fetchall()]

            # --- Autocomplete Suggestion Logic ---
            suggestions = []
            if text_query:
                sugg_fts_query = f'"{text_query}"*'
                sugg_sql = """
                    SELECT name AS suggestion FROM songs_fts WHERE name MATCH ?
                    UNION
                    SELECT artist AS suggestion FROM songs_fts WHERE artist MATCH ?
                    ORDER BY suggestion LIMIT 10
                """
                sugg_params = (sugg_fts_query, sugg_fts_query)
                suggestions = [row['suggestion'] for row in c.execute(sugg_sql, sugg_params).fetchall() if row['suggestion']]

            return {
                'songs': self._fetch_and_format_songs_by_ids(c, song_ids),
                'suggestions': suggestions
            }

    def get_all_song_paths(self):
        """Returns a set of all song paths currently in the database."""
        with self._get_db_conn() as conn:
            return {row['path'] for row in conn.execute("SELECT path FROM songs").fetchall()}

    def get_existing_titles(self, titles):
        """Checks a list of titles against the database and returns a set of those that already exist (case-insensitive)."""
        if not titles:
            return set()
        
        with self._get_db_conn() as conn:
            c = conn.cursor()
            # Prepare titles for query (lowercase, unique, non-empty)
            lower_titles = tuple(set(t.lower() for t in titles if t))
            if not lower_titles:
                return set()
            
            placeholders = ','.join('?' for _ in lower_titles)
            query = f"SELECT lower(name) as lower_name FROM songs WHERE lower(name) IN ({placeholders})"
            c.execute(query, lower_titles)
            
            return {row['lower_name'] for row in c.fetchall()}

    def get_all_playlist_names(self):
        """Returns a set of all playlist names currently in the database."""
        with self._get_db_conn() as conn:
            return {row['name'] for row in conn.execute("SELECT name FROM playlists").fetchall()}

    def get_song_paths_for_playlist(self, playlist_name):
        """Fetches the ordered list of web paths for songs in a playlist."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM playlists WHERE name=?", (playlist_name,))
            playlist_id_row = c.fetchone()
            if not playlist_id_row:
                return []
            playlist_id = playlist_id_row['id']
            
            c.execute("SELECT s.path FROM songs s JOIN playlist_songs ps ON s.id = ps.song_id WHERE ps.playlist_id = ? ORDER BY ps.song_order_index", (playlist_id,))
            return [row['path'] for row in c.fetchall()]

    def song_exists(self, web_path):
        """Checks if a song with the given path exists in the database."""
        with self._get_db_conn() as conn:
            return conn.execute("SELECT 1 FROM songs WHERE path = ?", (web_path,)).fetchone() is not None

    def get_cover_path_for_song(self, web_path):
        """Retrieves the cover path for a given song path."""
        with self._get_db_conn() as conn:
            res = conn.execute("SELECT cover_path FROM songs WHERE path = ?", (web_path,)).fetchone()
            return res['cover_path'] if res else None

    def get_all_songs_with_covers(self):
        """Fetches all songs that have a cover_path."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT path, cover_path FROM songs WHERE cover_path IS NOT NULL AND cover_path != ''")
            return [dict(row) for row in c.fetchall()]

    def save_song_color(self, web_path, color_obj):
        """Saves the RGB accent color for a song."""
        with self._get_db_conn() as conn:
            conn.execute("UPDATE songs SET accent_color_r = ?, accent_color_g = ?, accent_color_b = ? WHERE path = ?", (color_obj['r'], color_obj['g'], color_obj['b'], web_path))
            conn.commit()

    def create_tag(self, name, category_id):
        """Creates a new user-defined tag."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            c.execute("INSERT INTO tags (name, category_id, is_default) VALUES (?, ?, 0)", (name, category_id))
            conn.commit()
            c.execute("SELECT * FROM tags WHERE id = ?", (c.lastrowid,))
            return dict(c.fetchone())

    def rename_tag(self, tag_id, new_name):
        """Renames a tag, checking for conflicts."""
        with self._get_db_conn() as conn:
            with conn: # Transaction
                c = conn.cursor()
                c.execute("SELECT category_id, is_default FROM tags WHERE id = ?", (tag_id,))
                tag_info = c.fetchone()
                if not tag_info:
                    raise ValueError("Tag not found.")
                if tag_info['is_default']:
                    raise ValueError("Cannot rename a default tag.")
                
                # Check for name conflict within the same category
                c.execute("SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND category_id = ?", (new_name, tag_info['category_id']))
                existing = c.fetchone()
                if existing and existing['id'] != tag_id:
                     raise sqlite3.IntegrityError(f"Tag '{new_name}' already exists in this category.")

                c.execute("UPDATE tags SET name = ? WHERE id = ?", (new_name, tag_id))

    def delete_tag(self, tag_id):
        """Deletes a non-default tag. Associations are removed via ON DELETE CASCADE."""
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                c.execute("SELECT is_default FROM tags WHERE id = ?", (tag_id,))
                tag_info = c.fetchone()
                if not tag_info:
                    raise ValueError("Tag not found.")
                if tag_info['is_default']:
                    raise ValueError("Cannot delete a default tag.")
                
                c.execute("DELETE FROM tags WHERE id = ?", (tag_id,))

    def merge_tags(self, source_tag_id, dest_tag_id):
        """Reassigns songs from a source tag to a destination tag, deletes the source tag,
        and returns all affected data for frontend update."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            
            # Basic validation
            if source_tag_id == dest_tag_id:
                raise ValueError("Cannot merge a tag with itself.")

            c.execute("SELECT id, category_id, is_default FROM tags WHERE id = ?", (source_tag_id,))
            source_tag = c.fetchone()
            c.execute("SELECT id, category_id FROM tags WHERE id = ?", (dest_tag_id,))
            dest_tag = c.fetchone()

            if not source_tag or not dest_tag:
                raise ValueError("One or both tags not found.")
            
            if source_tag['category_id'] != dest_tag['category_id']:
                raise ValueError("Cannot merge tags from different categories.")
            if source_tag['is_default']:
                raise ValueError("Cannot merge a default tag into another tag.")

            # 1. Get all songs that have the source tag BEFORE the merge.
            c.execute("SELECT song_id FROM song_tags WHERE tag_id = ?", (source_tag_id,))
            song_ids_to_update = [row['song_id'] for row in c.fetchall()]

            # Perform the merge inside a transaction
            with conn:
                # 2. Add the destination tag to all those songs. `OR IGNORE` handles songs that already have the dest tag.
                if song_ids_to_update:
                    c.executemany("INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)", 
                                  [(song_id, dest_tag_id) for song_id in song_ids_to_update])

                # 3. Delete the source tag. The `ON DELETE CASCADE` on `song_tags` will clean up old associations.
                c.execute("DELETE FROM tags WHERE id = ?", (source_tag_id,))
            
            # After the transaction, fetch the updated data for the frontend
            # 4. Fetch the full, updated song objects for the affected songs.
            updated_songs_list = self._fetch_and_format_songs_by_ids(c, song_ids_to_update)
            updated_songs_map = {song['path']: song for song in updated_songs_list}

            # 5. Fetch the complete, updated tag data.
            updated_tag_data = self._get_all_tags(c)

            return {
                "updatedSongsMap": updated_songs_map,
                "tagData": updated_tag_data
            }

    def update_song_details(self, web_paths, details):
        """Updates details for one or more songs (name, artist, tags) in a single transaction."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            
            # 1. Get song IDs from paths
            placeholders = ','.join('?' for _ in web_paths)
            c.execute(f"SELECT id FROM songs WHERE path IN ({placeholders})", tuple(web_paths))
            song_ids = [row['id'] for row in c.fetchall()]
            if not song_ids:
                return []

            with conn: # 2. Start transaction
                # 3. Handle metadata updates (name, artist)
                update_parts = []
                params = []
                if 'name' in details:
                    update_parts.append("name = ?")
                    params.append(details['name'])
                if 'artist' in details:
                    update_parts.append("artist = ?")
                    params.append(details['artist'])
                
                if update_parts:
                    id_placeholders = ','.join('?' for _ in song_ids)
                    params.extend(song_ids)
                    c.execute(f"UPDATE songs SET {', '.join(update_parts)} WHERE id IN ({id_placeholders})", tuple(params))

                # 4. Handle tag updates
                # Multi-edit logic (additive/subtractive)
                if 'tagsToAdd' in details and details.get('tagsToAdd'):
                    tags_to_add = details['tagsToAdd']
                    c.executemany("INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)", 
                                  [(song_id, tag_id) for song_id in song_ids for tag_id in tags_to_add])
                
                if 'tagsToRemove' in details and details.get('tagsToRemove'):
                    tags_to_remove = details['tagsToRemove']
                    song_id_placeholders = ','.join('?' for _ in song_ids)
                    tag_id_placeholders = ','.join('?' for _ in tags_to_remove)
                    c.execute(f"DELETE FROM song_tags WHERE song_id IN ({song_id_placeholders}) AND tag_id IN ({tag_id_placeholders})", 
                              song_ids + tags_to_remove)
                
                # Single-edit logic (replacement)
                elif 'tagIds' in details:
                    # This should only be for a single song, so song_ids will have one element.
                    if song_ids:
                        song_id = song_ids[0]
                        c.execute("DELETE FROM song_tags WHERE song_id = ?", (song_id,))
                        if details.get('tagIds'):
                            c.executemany("INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)", 
                                          [(song_id, t_id) for t_id in details['tagIds']])
            
            # 5. Fetch and return fully updated song objects
            return self._fetch_and_format_songs_by_ids(c, song_ids)

    def change_song_cover_in_db(self, web_path, new_cover_web_path):
        """Updates a song's cover path and resets its accent color."""
        with self._get_db_conn() as conn:
            conn.execute("UPDATE songs SET cover_path = ?, accent_color_r = NULL, accent_color_g = NULL, accent_color_b = NULL WHERE path = ?", (new_cover_web_path, web_path))
            conn.commit()

    def save_markers(self, web_path, markers):
        """Saves a list of marker timestamps for a song, replacing any existing ones."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM songs WHERE path = ?", (web_path,))
            song_id = c.fetchone()['id']
            with conn:
                c.execute("DELETE FROM markers WHERE song_id = ?", (song_id,))
                if markers:
                    c.executemany("INSERT INTO markers (song_id, timestamp) VALUES (?, ?)", [(song_id, ts) for ts in markers])

    def add_songs_to_playlist(self, playlist_name, songs):
        """Adds multiple songs to a specified playlist."""
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                c.execute("SELECT id FROM playlists WHERE name = ?", (playlist_name,))
                p_id = c.fetchone()['id']
                c.execute("SELECT MAX(song_order_index) FROM playlist_songs WHERE playlist_id = ?", (p_id,))
                next_order = (c.fetchone()[0] or -1) + 1
                for i, song in enumerate(songs):
                    c.execute("INSERT OR IGNORE INTO songs (path, name, artist, cover_path) VALUES (?, ?, ?, ?)", (song['path'], song['name'], song['artist'], song.get('coverPath')))
                    c.execute("SELECT id FROM songs WHERE path=?", (song['path'],))
                    s_id = c.fetchone()['id']
                    c.execute("INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, song_order_index) VALUES (?, ?, ?)", (p_id, s_id, next_order + i))

    def reorder_playlist_songs(self, playlist_name, song_path_order):
        """Updates the order of songs within a playlist based on a new list of paths."""
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                c.execute("SELECT id FROM playlists WHERE name = ?", (playlist_name,))
                p_id = c.fetchone()['id']
                c.executemany("UPDATE playlist_songs SET song_order_index = ? WHERE playlist_id = ? AND song_id = (SELECT id FROM songs WHERE path = ?)", [(i, p_id, path) for i, path in enumerate(song_path_order)])

    def reorder_playlists(self, playlist_name_order):
        """Updates the display order of the playlists."""
        with self._get_db_conn() as conn:
            with conn:
                conn.executemany("UPDATE playlists SET order_index = ? WHERE name = ?", list(enumerate(playlist_name_order)))

    def move_songs_to_playlist(self, source_playlist, target_playlist, song_paths):
        """Atomically moves songs from one playlist to another."""
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                c.execute("SELECT id FROM playlists WHERE name=?",(source_playlist,))
                source_id = c.fetchone()['id']
                c.execute("SELECT id FROM playlists WHERE name=?",(target_playlist,))
                target_id = c.fetchone()['id']
                
                placeholders = ','.join('?' for _ in song_paths)
                c.execute(f"SELECT id FROM songs WHERE path IN ({placeholders})", song_paths)
                song_ids = [r['id'] for r in c.fetchall()]
                id_placeholders = ','.join('?' for _ in song_ids)
                
                c.execute(f"DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id IN ({id_placeholders})", [source_id] + song_ids)
                c.execute("SELECT MAX(song_order_index) FROM playlist_songs WHERE playlist_id = ?", (target_id,))
                next_order = (c.fetchone()[0] or -1) + 1
                c.executemany("INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, song_order_index) VALUES (?, ?, ?)", [(target_id, s_id, next_order + i) for i, s_id in enumerate(song_ids)])

    def rename_playlist(self, old_name, new_name):
        """Renames a playlist."""
        with self._get_db_conn() as conn:
            with conn:
                conn.execute("UPDATE playlists SET name = ? WHERE name = ?", (new_name, old_name))

    def delete_songs(self, web_paths):
        """Deletes songs from the DB and returns a list of associated files to be deleted."""
        files_to_delete = []
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                placeholders = ','.join('?' for _ in web_paths)
                c.execute(f"SELECT path, cover_path FROM songs WHERE path IN ({placeholders})", web_paths)
                for row in c.fetchall():
                    if row['path']: files_to_delete.append(utils.web_to_os_path(row['path']))
                    if row['cover_path']: files_to_delete.append(utils.web_to_os_path(row['cover_path']))
                c.execute(f"DELETE FROM songs WHERE path IN ({placeholders})", web_paths)
        return files_to_delete

    def delete_playlist(self, name):
        """Deletes a playlist and any songs that become orphaned as a result."""
        files_to_delete = []
        with self._get_db_conn() as conn:
            with conn:
                c = conn.cursor()
                # Deleting the playlist will cascade and delete its playlist_songs entries
                c.execute("DELETE FROM playlists WHERE name = ?", (name,))
                # Find songs that no longer belong to any playlist
                c.execute("SELECT id, path, cover_path FROM songs WHERE id NOT IN (SELECT DISTINCT song_id FROM playlist_songs)")
                orphans = c.fetchall()
                if orphans:
                    orphan_ids = [o['id'] for o in orphans]
                    for o in orphans:
                        if o['path']: files_to_delete.append(utils.web_to_os_path(o['path']))
                        if o['cover_path']: files_to_delete.append(utils.web_to_os_path(o['cover_path']))
                    # Delete the orphaned songs from the main songs table
                    c.execute(f"DELETE FROM songs WHERE id IN ({','.join('?'*len(orphan_ids))})", orphan_ids)
        return files_to_delete

    def get_playlist_data_for_export(self, playlist_name):
        """Fetches a playlist's data in a portable format for export."""
        with self._get_db_conn() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM playlists WHERE name=?", (playlist_name,))
            playlist_id = c.fetchone()['id']
            
            export_data = {"name": playlist_name, "songs": []}
            c.execute("SELECT s.* FROM songs s JOIN playlist_songs ps ON s.id = ps.song_id WHERE ps.playlist_id = ? ORDER BY ps.song_order_index", (playlist_id,))
            songs = c.fetchall()
            
            for s_row in songs:
                song_id = s_row['id']
                song_obj = {
                    "name": s_row['name'],
                    "artist": s_row['artist'],
                    "path": s_row['path'],
                    "coverPath": s_row['cover_path'],
                    "markers": [],
                    "tags": {}
                }
                
                c.execute("SELECT timestamp FROM markers WHERE song_id=? ORDER BY timestamp", (song_id,))
                song_obj["markers"] = [m['timestamp'] for m in c.fetchall()]
                
                c.execute("SELECT t.name as tag_name, tc.name as category_name FROM tags t JOIN tag_categories tc ON t.category_id = tc.id JOIN song_tags st ON st.tag_id = t.id WHERE st.song_id = ?", (song_id,))
                for tag_row in c.fetchall():
                    cat = tag_row['category_name']
                    if cat not in song_obj['tags']: song_obj['tags'][cat] = []
                    song_obj['tags'][cat].append(tag_row['tag_name'])
                
                export_data['songs'].append(song_obj)
            return export_data
            
    def import_playlist_from_data(self, manifest, playlist_name):
        """Imports playlist data from a manifest into the database using batched queries for performance."""
        with self._get_db_conn() as conn:
            c = conn.cursor()

            # --- Data Preparation ---
            # 1. Pre-fetch existing categories and tags into maps for fast lookups.
            c.execute("SELECT id, name FROM tag_categories")
            categories_map = {row['name']: row['id'] for row in c.fetchall()}
            
            c.execute("SELECT id, name, category_id FROM tags")
            tags_map = {(row['name'], row['category_id']): row['id'] for row in c.fetchall()}

            # 2. Collect all unique new categories and tags from the manifest.
            new_categories_to_create = set()
            new_tags_to_create = set() # Stores tuples of (tag_name, category_name)
            for song_data in manifest['songs']:
                if song_data.get('tags'):
                    for cat_name, tag_names in song_data['tags'].items():
                        if cat_name not in categories_map:
                            new_categories_to_create.add(cat_name)
                        for tag_name in tag_names:
                            # We can't check tags_map yet as we don't have the final category ID
                            new_tags_to_create.add((tag_name, cat_name))

            # --- Database Write Operations (within a single transaction) ---
            with conn:
                # 3. Batch create new categories if any.
                if new_categories_to_create:
                    c.executemany("INSERT OR IGNORE INTO tag_categories (name) VALUES (?)", [(cat_name,) for cat_name in new_categories_to_create])
                    # Refresh the categories map to include the newly created ones.
                    c.execute("SELECT id, name FROM tag_categories")
                    categories_map = {row['name']: row['id'] for row in c.fetchall()}
                
                # 4. Prepare and batch create new tags.
                tags_to_insert = []
                for tag_name, cat_name in new_tags_to_create:
                    cat_id = categories_map.get(cat_name)
                    if cat_id and (tag_name, cat_id) not in tags_map:
                        tags_to_insert.append((tag_name, cat_id, 0)) # name, category_id, is_default=0

                if tags_to_insert:
                    c.executemany("INSERT OR IGNORE INTO tags (name, category_id, is_default) VALUES (?, ?, ?)", tags_to_insert)
                    # Refresh the tags map.
                    c.execute("SELECT id, name, category_id FROM tags")
                    tags_map = {(row['name'], row['category_id']): row['id'] for row in c.fetchall()}
                
                # 5. Create the playlist.
                c.execute("SELECT MAX(order_index) FROM playlists")
                next_order_index = (c.fetchone()[0] or -1) + 1
                c.execute("INSERT INTO playlists (name, order_index) VALUES (?, ?)", (playlist_name, next_order_index))
                playlist_id = c.lastrowid
                
                # --- Process songs, linking everything together ---
                newly_created_songs_map = {}
                playlist_paths = []
                song_tag_links_to_create = []

                for i, song_data in enumerate(manifest['songs']):
                    # 6. Insert song and get its ID.
                    c.execute("INSERT OR IGNORE INTO songs (path, name, artist, cover_path) VALUES (?, ?, ?, ?)", 
                              (song_data['path'], song_data['name'], song_data['artist'], song_data.get('coverPath')))
                    c.execute("SELECT id FROM songs WHERE path=?", (song_data['path'],))
                    song_id = c.fetchone()['id']
                    
                    # Link song to the new playlist.
                    c.execute("INSERT INTO playlist_songs (playlist_id, song_id, song_order_index) VALUES (?, ?, ?)", (playlist_id, song_id, i))
                    
                    # 7. Handle markers (already batched).
                    if song_data.get('markers'):
                        c.executemany("INSERT INTO markers (song_id, timestamp) VALUES (?, ?)", 
                                      [(song_id, ts) for ts in song_data['markers']])

                    # 8. Collect song-tag links and build the song object for the frontend.
                    all_tag_ids_for_song = []
                    if song_data.get('tags'):
                        for cat_name, tag_names in song_data['tags'].items():
                            cat_id = categories_map[cat_name]
                            for tag_name in tag_names:
                                tag_id = tags_map[(tag_name, cat_id)]
                                all_tag_ids_for_song.append(tag_id)
                                song_tag_links_to_create.append((song_id, tag_id))
                    
                    path = song_data['path']
                    playlist_paths.append(path)
                    newly_created_songs_map[path] = {
                        "path": path,
                        "name": song_data['name'],
                        "artist": song_data['artist'],
                        "coverPath": song_data.get('coverPath'),
                        "isMissing": False,
                        "accentColor": None,
                        "markers": [{'id': f"marker_{j}_{ts}", 'timestamp': ts} for j, ts in enumerate(song_data.get('markers', []))],
                        "tagIds": all_tag_ids_for_song
                    }
                
                # 9. Batch create all song-tag links.
                if song_tag_links_to_create:
                    c.executemany("INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)", song_tag_links_to_create)
            
            # --- Return data to frontend ---
            return {
                "name": playlist_name,
                "paths": playlist_paths,
                "songs": newly_created_songs_map
            }