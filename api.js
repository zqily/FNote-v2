/**
 * @module Api
 * This module wraps all calls to the Python backend, providing a clean,
 * Promise-based interface for the frontend JavaScript.
 */

// List of API methods that can wait for user input indefinitely (file dialogs)
// or are long-running background tasks. They should not have a timeout.
const NO_TIMEOUT_METHODS = [
    'importFromFiles',
    'finalizeFileImport',
    'changeSongCover',
    'exportPlaylist',
    'exportPlaylistAsM3U',
    'importPlaylist',
    'updateYtDlp',
    'broadcast_state_change'
];
const API_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Generic API call wrapper to handle responses and errors consistently.
 * @param {Function} apiMethod - The pywebview.api method to call.
 * @param {...any} args - Arguments to pass to the apiMethod.
 * @returns {Promise<any>} A promise that resolves with the API response or rejects with an error.
 */
async function callApi(apiMethod, ...args) {
    const useTimeout = !NO_TIMEOUT_METHODS.includes(apiMethod.name);
    let timeoutId;

    try {
        const apiPromise = apiMethod(...args);
        const promisesToRace = [apiPromise];

        if (useTimeout) {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`The operation timed out. The backend may be unresponsive or a required service is unavailable.`));
                }, API_TIMEOUT_MS);
            });
            promisesToRace.push(timeoutPromise);
        }

        const response = await Promise.race(promisesToRace);

        if (useTimeout) clearTimeout(timeoutId);

        // Check for explicit error status from backend
        if (response && typeof response === 'object' && response.status === 'error') {
            const errorMessage = response.message || 'An unspecified error occurred in the backend.';
            console.error(`API Error for ${apiMethod.name}:`, errorMessage, 'Args:', ...args);
            throw new Error(errorMessage);
        }
        
        return response;
    } catch (e) { // Catches errors from pywebview.api, the timeout, or the explicit throw above
        if (useTimeout) clearTimeout(timeoutId);
        
        const errorMessage = e.message || `A network or backend error occurred while calling ${apiMethod.name}.`;
        console.error(`Critical API Exception for ${apiMethod.name}:`, e, 'Args:', ...args);
        
        if (e instanceof Error) throw e;
        throw new Error(errorMessage);
    }
}


/** Fetches the initial application configuration. */
export const getInitialConfig = () => callApi(pywebview.api.get_initial_config);
/** Fetches all initial music and tag data from the database. */
export const getInitialData = () => callApi(pywebview.api.get_initial_data);

/** Saves the player volume. @param {number} volume */
export const saveVolume = (volume) => callApi(pywebview.api.save_volume, volume);
/** Saves the player loop mode. @param {string} mode */
export const saveLoopMode = (mode) => callApi(pywebview.api.save_loop_mode, mode);
/** Saves the player shuffle mode. @param {boolean} isShuffling */
export const saveShuffleMode = (isShuffling) => callApi(pywebview.api.save_shuffle_mode, isShuffling);
/** Saves the sidebar width. @param {number} width */
export const saveSidebarWidth = (width) => callApi(pywebview.api.save_sidebar_width, width);
/** Saves the playlist section height. @param {number} height */
export const savePlaylistSectionHeight = (height) => callApi(pywebview.api.save_playlist_section_height, height);
/** Saves the toast notification duration. @param {number} duration */
export const saveToastDuration = (duration) => callApi(pywebview.api.save_toast_duration, duration);
/** Saves the generated accent color for a song. @param {string} path @param {object} color */
export const saveSongColor = (path, color) => callApi(pywebview.api.save_song_color, path, color);
/** Saves the last playback state for recovery. @param {object} state */
export const savePlaybackState = (state) => callApi(pywebview.api.save_playback_state, state);
/** Saves the markers for a song. @param {string} path @param {number[]} markers */
export const saveMarkers = (path, markers) => callApi(pywebview.api.save_markers, path, markers);
/** Saves the currently active playlist. @param {string} name */
export const saveActivePlaylist = (name) => callApi(pywebview.api.save_active_playlist, name);
/** Saves the 'resume on startup' setting. @param {boolean} enable */
export const saveResumeOnStartup = (enable) => callApi(pywebview.api.save_resume_on_startup, enable);
/** Saves the user-defined audio process blacklist. @param {string[]} blacklist */
export const saveAudioProcBlacklist = (blacklist) => callApi(pywebview.api.save_audio_proc_blacklist, blacklist);

/** Enables or disables running the app on system startup. @param {boolean} enable */
export const setRunOnStartup = (enable) => callApi(pywebview.api.set_run_on_startup, enable);
/** Registers the .fnlist file type with the OS. */
export const registerFileType = () => callApi(pywebview.api.register_file_type);
/** Gets the path of a file the app was opened with. */
export const getStartupFile = () => callApi(pywebview.api.get_startup_file);
/** Fetches full song data for a list of paths. @param {string[]} paths */
export const getSongsByPaths = (paths) => callApi(pywebview.api.get_songs_by_paths, paths);
/** Enables or disables the auto-pause on external audio feature. @param {boolean} enable */
export const setAutoPauseEnabled = (enable) => callApi(pywebview.api.set_auto_pause_enabled, enable);
/** Enables or disables Discord Rich Presence. @param {boolean} enable */
export const setDiscordPresenceEnabled = (enable) => callApi(pywebview.api.set_discord_presence_enabled, enable);
/** Sends a presence update to Discord. @param {object|null} data */
export const updateRichPresence = (data) => callApi(pywebview.api.update_rich_presence, data);


/** Opens a file dialog to import songs from local files, with a preliminary duplicate check. */
export const importFromFiles = () => callApi(pywebview.api.import_from_files);
/** Finalizes the import of files after user confirmation. @param {string[]} paths */
export const finalizeFileImport = (paths) => callApi(pywebview.api.finalize_file_import, paths);
/** Fetches metadata for a given URL. @param {string} url */
export const fetchUrlMetadata = (url) => callApi(pywebview.api.fetch_url_metadata, url);
/** Kicks off a background task to download from a URL with progress. @param {string} url @param {number[]} indices */
export const startUrlDownload = (url, indices) => callApi(pywebview.api.start_url_download, url, indices);
/** Gets the base64 data URI for a song's audio content. @param {string} path */
export const getSongDataUri = (path) => callApi(pywebview.api.get_song_data_uri, path);
/** Searches all songs in the library. @param {string} query */
export const searchAllSongs = (query) => callApi(pywebview.api.search_all_songs, query);
/** Searches songs within a specific playlist. @param {string} playlistName @param {string} query */
export const searchInPlaylist = (playlistName, query) => callApi(pywebview.api.search_in_playlist, playlistName, query);

/** Adds an array of song objects to a playlist. @param {string} playlistName @param {object[]} songs */
export const addSongsToPlaylist = (playlistName, songs) => callApi(pywebview.api.add_songs_to_playlist, playlistName, songs);
/** Deletes songs from the library and filesystem. @param {string[]} paths */
export const deleteSongs = (paths) => callApi(pywebview.api.delete_songs, paths);
/** Deletes a playlist. @param {string} name */
export const deletePlaylist = (name) => callApi(pywebview.api.delete_playlist, name);
/** Renames a playlist. @param {string} oldName @param {string} newName */
export const renamePlaylist = (oldName, newName) => callApi(pywebview.api.rename_playlist, oldName, newName);
/** Saves the new order of playlists. @param {string[]} order */
export const reorderPlaylists = (order) => callApi(pywebview.api.reorder_playlists, order);
/** Saves the new order of songs within a playlist. @param {string} playlistName @param {string[]} songPathOrder */
export const reorderPlaylistSongs = (playlistName, songPathOrder) => callApi(pywebview.api.reorder_playlist_songs, playlistName, songPathOrder);
/** Moves songs from a source to a target playlist. @param {string} source @param {string} target @param {string[]} paths */
export const moveSongsToPlaylist = (source, target, paths) => callApi(pywebview.api.move_songs_to_playlist, source, target, paths);
/** Exports a playlist to a .fnlist file. @param {string} playlistName */
export const exportPlaylist = (playlistName) => callApi(pywebview.api.export_playlist, playlistName);
/** Exports a playlist to an M3U file. @param {string} playlistName */
export const exportPlaylistAsM3U = (playlistName) => callApi(pywebview.api.export_playlist_as_m3u, playlistName);
/** Imports a playlist from a .fnlist file, optionally from a given path. @param {string|null} [path=null] */
export const importPlaylist = (path = null) => callApi(pywebview.api.import_playlist, path);

/** Opens a file dialog to change a song's cover art. @param {string} path */
export const changeSongCover = (path) => callApi(pywebview.api.change_song_cover, path);
/** Gets the base64 data URI for a song's cover. @param {string} path */
export const getCoverData = (path) => callApi(pywebview.api.get_cover_data, path);
/** Generates a dominant accent color from a song's cover. @param {string} path */
export const generateAccentColor = (path) => callApi(pywebview.api.generate_accent_color, path);
/** Kicks off a background task to refresh all accent colors. */
export const refreshAllAccentColors = () => callApi(pywebview.api.refresh_all_accent_colors);
/** Opens a URL in the default external browser. @param {string} url */
export const openExternalLink = (url) => callApi(pywebview.api.open_external_link, url);
/** Creates a new tag in a given category. @param {string} name @param {number} categoryId */
export const createTag = (name, categoryId) => callApi(pywebview.api.create_tag, name, categoryId);
/** Renames a tag. @param {number} tagId @param {string} newName */
export const renameTag = (tagId, newName) => callApi(pywebview.api.rename_tag, tagId, newName);
/** Deletes a tag. @param {number} tagId */
export const deleteTag = (tagId) => callApi(pywebview.api.delete_tag, tagId);
/** Merges a source tag into a destination tag. @param {number} sourceTagId @param {number} destTagId */
export const mergeTags = (sourceTagId, destTagId) => callApi(pywebview.api.merge_tags, sourceTagId, destTagId);
/** Updates details for one or more songs (name, artist, tags). @param {string[]} paths @param {object} details */
export const updateSongDetails = (paths, details) => callApi(pywebview.api.update_song_details, paths, details);
/** Shows a file in the system's file explorer. @param {string} path */
export const showInExplorer = (path) => callApi(pywebview.api.show_in_explorer, path);
/** Checks for a new version of yt-dlp. */
export const checkYtDlpUpdate = () => callApi(pywebview.api.check_yt_dlp_update);
/** Starts the yt-dlp update process. */
export const updateYtDlp = () => callApi(pywebview.api.update_yt_dlp);

// --- Inter-window communication ---
/** Toggles between the main window and mini-player. @param {boolean} enable */
export const toggleMiniPlayer = (enable) => callApi(pywebview.api.toggle_mini_player, enable);
/** Broadcasts a state change payload to other windows. @param {object} payload */
export const broadcastStateChange = (payload) => callApi(pywebview.api.broadcast_state_change, payload);