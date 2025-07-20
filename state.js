/**
 * @module State
 * Centralized state management for the application using a publish-subscribe pattern.
 * This is the single source of truth for all dynamic data. All state modifications
 * must go through the exported mutator functions.
 */

import * as UI from '../ui/index.js';
import * as Player from './player.js';

const state = {
    // Core music library data (normalized)
    musicData: {
        songs: {},                     // Object mapping song paths to song objects (acts as a cache)
        playlists: { 'Default': [] },  // Object mapping playlist names to arrays of song paths
        playlistOrder: ['Default'],    // Array of playlist names to maintain display order
        activePlaylist: 'Default'      // The name of the currently active playlist
    },
    // Tagging data
    tagData: [], // Array of tag categories, each containing an array of tag objects

    // Playback state
    playQueue: [],             // Array of song objects to be played next
    currentSongIndex: -1,      // Index of the currently playing song in the active playlist
    loopMode: 'none',          // 'none', 'song', or 'playlist'
    isShuffling: false,
    shuffledPlaylist: [],      // A shuffled copy of the active playlist (contains full song objects)
    shuffledIndex: -1,         // The current index within the shuffledPlaylist
    wasPlayingBeforeExternalAudio: false,

    // UI and selection state
    selectedSongPaths: [],     // Array of paths for selected songs in the list
    lastClickedPath: null,     // The last song path clicked, for shift-selection
    viewMode: 'playlist',      // The current view in the sidebar: 'playlist' or 'queue'
    searchMode: 'filter',      // 'filter' or 'global'
    selectedMarker: null,      // The currently selected marker object on the seek bar
    coverCache: {},            // LRU-ish cache for base64 cover art. Key: song.path, Value: base64 data
    
    // UI interaction state
    contextMenuTarget: null,   // The target identifier (e.g., playlist name) for a context menu
    draggedElement: null,      // The HTML element being dragged
    isExternalAudioActive: false,
    externalAudioSources: [],
    
    // Application settings
    toastDuration: 3,          // Default notification duration in seconds
    runOnStartup: false,
    resumeOnStartup: false,
    isStartupLaunch: false,
    autoPauseEnabled: false,
    autoPauseAudioProcBlacklist: [],
    discordRichPresenceEnabled: false,
};

let isUpdating = false; // The lock flag to prevent concurrent state mutations

// --- Pub/Sub Implementation ---
const subscribers = {};

/**
 * Publishes an event to all registered subscribers.
 * @param {string} event - The name of the event to publish.
 * @param {*} data - The data to pass to subscriber callbacks.
 */
function publish(event, data) {
    subscribers[event]?.forEach(callback => callback(data));
}

/**
 * Subscribes a callback function to an event.
 * @param {string} event - The name of the event to subscribe to.
 * @param {Function} callback - The function to execute when the event is published.
 */
export function subscribe(event, callback) {
    if (typeof callback !== 'function') {
        console.error(`Attempted to subscribe to "${event}" with a non-function.`, callback);
        return;
    }
    if (!subscribers[event]) {
        subscribers[event] = [];
    }
    subscribers[event].push(callback);
}

// --- Getters ---

/**
 * Returns a shallow copy of the entire state object.
 * @returns {object} The application state.
 */
export const getState = () => ({ ...state });

/**
 * Gets the array of song objects for the currently active playlist.
 * This is a computed getter that denormalizes the state for UI consumption.
 * It returns song objects from the cache, or placeholders for uncached songs.
 * @returns {object[]} An array of song objects or placeholders.
 */
export const getActivePlaylist = () => {
    const activePlaylistPaths = state.musicData.playlists[state.musicData.activePlaylist] || [];
    // Map paths to song objects from the central 'songs' map.
    // Return a placeholder for any song not yet in the cache.
    return activePlaylistPaths
        .map(path => state.musicData.songs[path] || { path, isPlaceholder: true });
};

/**
 * Gets cover art data for a song path from the cache.
 * @param {string} path - The song's path.
 * @returns {string|undefined} The base64 data URI or undefined if not cached.
 */
export const getCoverFromCache = (path) => state.coverCache[path];


// --- Mutators ---

export const setMusicData = (data) => {
    // When new musicData is set (e.g., from an import), ensure the song cache is updated, not replaced.
    if (data.songs) {
        state.musicData.songs = { ...state.musicData.songs, ...data.songs };
    }
    if (data.playlists) {
        state.musicData.playlists = data.playlists;
    }
    if (data.playlistOrder) {
        state.musicData.playlistOrder = data.playlistOrder;
    }
    if (data.activePlaylist) {
        state.musicData.activePlaylist = data.activePlaylist;
    }
    publish('musicData', state.musicData);
};
export const setTagData = (data) => {
    state.tagData = data;
    publish('tagData', data);
};
export const setActivePlaylist = (playlistName) => {
    state.musicData.activePlaylist = playlistName;
    publish('activePlaylist', playlistName);
};
export const setPlaylistOrder = (order) => {
    state.musicData.playlistOrder = order;
    publish('playlistOrder', order);
};
export const setPlaylists = (playlists) => {
    state.musicData.playlists = playlists;
    publish('playlists', playlists);
};
export const setPlayQueue = (queue) => {
    state.playQueue = queue;
    publish('playQueue', queue);
};
export const setCurrentSongIndex = (index) => {
    state.currentSongIndex = index;
    publish('currentSongIndex', index);
};
export const setSelectedSongPaths = (paths) => {
    state.selectedSongPaths = paths;
    publish('selectedSongPaths', paths);
};
export const setLastClickedPath = (path) => {
    state.lastClickedPath = path;
    publish('lastClickedPath', path);
};
export const setLoopMode = (mode) => {
    state.loopMode = mode;
    publish('loopMode', mode);
};
export const setShuffling = (isShuffling) => {
    state.isShuffling = isShuffling;
    publish('isShuffling', isShuffling);
};
export const setShuffledPlaylist = (playlist) => {
    state.shuffledPlaylist = playlist;
    publish('shuffledPlaylist', playlist);
};
export const setShuffledIndex = (index) => {
    state.shuffledIndex = index;
    publish('shuffledIndex', index);
};
export const setToastDuration = (duration) => {
    state.toastDuration = duration;
    publish('toastDuration', duration);
};
export const setRunOnStartup = (enable) => {
    state.runOnStartup = enable;
    publish('runOnStartup', enable);
};
export const setResumeOnStartup = (enable) => {
    state.resumeOnStartup = enable;
    publish('resumeOnStartup', enable);
};
export const setIsStartupLaunch = (isStartup) => {
    state.isStartupLaunch = isStartup;
    publish('isStartupLaunch', isStartup);
};
export const setContextMenuTarget = (target) => {
    state.contextMenuTarget = target;
    publish('contextMenuTarget', target);
};
export const setDraggedElement = (element) => {
    state.draggedElement = element;
    publish('draggedElement', element);
};
export const setSelectedMarker = (marker) => {
    state.selectedMarker = marker;
    publish('selectedMarker', marker);
};
export const setViewMode = (mode) => {
    state.viewMode = mode;
    publish('viewMode', mode);
};
export const setSearchMode = (mode) => {
    state.searchMode = mode;
    publish('searchMode', mode);
};
export const setAutoPauseEnabled = (isEnabled) => {
    state.autoPauseEnabled = isEnabled;
    publish('autoPauseEnabled', isEnabled);
};
export const setAutoPauseAudioProcBlacklist = (blacklist) => {
    state.autoPauseAudioProcBlacklist = blacklist;
    publish('autoPauseAudioProcBlacklist', blacklist);
};
export const setIsExternalAudioActive = (isActive) => {
    state.isExternalAudioActive = isActive;
    publish('isExternalAudioActive', isActive);
};
export const setExternalAudioSources = (sources) => {
    state.externalAudioSources = sources;
    publish('externalAudioSources', sources);
};
export const setWasPlayingBeforeExternalAudio = (wasPlaying) => {
    state.wasPlayingBeforeExternalAudio = wasPlaying;
    publish('wasPlayingBeforeExternalAudio', wasPlaying);
};
export const setDiscordPresenceEnabled = (isEnabled) => {
    state.discordRichPresenceEnabled = isEnabled;
    publish('discordRichPresenceEnabled', isEnabled);
};
export const setCoverInCache = (path, coverData) => {
    // A simple cache size limit to prevent unbounded memory growth.
    const keys = Object.keys(state.coverCache);
    if (keys.length > 50) {
        delete state.coverCache[keys[0]]; // Simple FIFO, not true LRU, but good enough.
    }
    state.coverCache[path] = coverData;
};


// --- High-Level State Operations ---

/**
 * Adds song objects to the client-side song cache.
 * @param {Object<string, object>} songsMap - A map of song paths to song objects.
 */
export const addSongsToCache = (songsMap) => {
    if (!songsMap || Object.keys(songsMap).length === 0) return;
    state.musicData.songs = { ...state.musicData.songs, ...songsMap };
    // This doesn't publish an event itself. The caller (virtualList) will trigger a re-render.
};

/**
 * Executes an optimistic UI update and an API call, with automatic state rollback on failure.
 * This function now includes a lock to prevent concurrent state mutations.
 * @param {Function} optimisticAction - A function that performs state changes and returns an `undoAction` function.
 * @param {Function} apiCall - An async function that returns the API promise.
 * @param {object} [options={}] - Configuration for messages and callbacks.
 * @param {string|Function} [options.successMessage] - Message for success toast. Can be a function receiving the api result.
 * @param {string} [options.errorMessagePrefix] - Prefix for the error toast message.
 * @param {Function} [options.onSuccess] - Callback on successful API call. Receives api result.
 * @param {boolean} [options.playerWasReset=false] - Flag to indicate if the player state was reset and needs special rollback handling.
 */
export async function performOptimisticUpdate(optimisticAction, apiCall, options = {}) {
    if (isUpdating) {
        console.warn('Another state update is already in progress. Ignoring request.');
        UI.showToast('Please wait for the current operation to complete.', 'info');
        return;
    }

    isUpdating = true;
    let undoAction = null;
    let originalAudioState = null;

    try {
        const { successMessage, errorMessagePrefix, onSuccess, playerWasReset = false } = options;

        // 1. Capture player state if it might be affected
        if (playerWasReset) {
            const audio = Player.getAudioPlayer();
            originalAudioState = {
                src: audio.src,
                currentTime: audio.currentTime,
                paused: audio.paused,
            };
        }

        // 2. Perform optimistic action, which returns an undo function
        undoAction = optimisticAction();

        // 3. Perform API call
        const result = await apiCall();

        // 4. Handle success
        if (onSuccess) {
            onSuccess(result);
        }
        if (successMessage) {
            const message = typeof successMessage === 'function' ? successMessage(result) : successMessage;
            UI.showToast(message, 'success');
        }
    } catch (e) {
        // 5. Handle failure
        console.error(`${errorMessagePrefix || 'Optimistic update failed'}:`, e);
        UI.showToast(`${errorMessagePrefix || 'Error'}: ${e.message}`, 'error');

        // --- Rollback state by calling the undo function ---
        if (undoAction) {
            undoAction();
        }

        // --- Restore player state if it was reset ---
        if (originalAudioState) {
            const audio = Player.getAudioPlayer();
            // If the src is different, set it and wait for it to load before restoring time/play state.
            if (audio.src !== originalAudioState.src) {
                audio.src = originalAudioState.src;
            }
            
            const restorePlayback = () => {
                audio.currentTime = originalAudioState.currentTime;
                if (!originalAudioState.paused) {
                    audio.play().catch(err => console.error("Rollback play failed:", err));
                } else if (!audio.src) {
                    // If player was completely reset (src is now empty), ensure UI reflects this.
                    UI.resetPlayerUI();
                }
            };

            if (audio.src) {
                // If the audio element is ready, restore state. Otherwise, wait for it to be ready.
                if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
                    restorePlayback();
                } else {
                    audio.addEventListener('loadedmetadata', restorePlayback, { once: true });
                }
            } else {
                restorePlayback();
            }
        }
    } finally {
        isUpdating = false;
    }
}

/**
 * Finds and updates a single song's data in the central song map.
 * @param {object} updatedSongData - An object containing the song's `path` and other properties to update.
 */
export const updateSong = (updatedSongData) => {
    if (!updatedSongData?.path || !state.musicData.songs[updatedSongData.path]) return;

    // Merge new data into the existing song object in the central map
    state.musicData.songs[updatedSongData.path] = { 
        ...state.musicData.songs[updatedSongData.path], 
        ...updatedSongData 
    };
    
    // Publish a generic event that interested components can subscribe to.
    publish('songUpdated', updatedSongData);
};