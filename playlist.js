/**
 * @module Playlist
 * Manages playlist state, CRUD operations, song selection, and drag-and-drop.
 */

import * as Api from './api.js';
import * as State from './state.js';
import * as DOM from './dom.js';
import * as UI from './ui/index.js';
import * as Player from './player.js';

// --- Drag and Drop Auto-scroll ---
const autoScroller = {
    animationFrameId: null,
    scrollTarget: null,
    scrollSpeed: 0,
    SCROLL_ZONE_SIZE: 60, // The size of the zone at the top/bottom of the container that triggers scrolling
    MAX_SCROLL_SPEED: 20, // Max pixels to scroll per frame
};

let cachedDraggablePlaylists = null;

/**
 * The main animation loop for auto-scrolling.
 */
function scrollLoop() {
    // Stop if there's no target or speed, or if the loop has been cancelled
    if (!autoScroller.scrollTarget || autoScroller.scrollSpeed === 0 || !autoScroller.animationFrameId) {
        stopDragAutoScroll();
        return;
    }

    // Apply the scroll and request the next frame
    autoScroller.scrollTarget.scrollTop += autoScroller.scrollSpeed;
    autoScroller.animationFrameId = requestAnimationFrame(scrollLoop);
}

/**
 * Checks if the cursor during a drag is near the top or bottom of a container
 * and adjusts the scroll speed based on proximity to the edge.
 * @param {DragEvent} e - The drag event.
 * @param {HTMLElement} container - The scrollable container element.
 */
function handleDragAutoScroll(e, container) {
    autoScroller.scrollTarget = container;
    const rect = container.getBoundingClientRect();
    const y = e.clientY;

    const topZoneEnd = rect.top + autoScroller.SCROLL_ZONE_SIZE;
    const bottomZoneStart = rect.bottom - autoScroller.SCROLL_ZONE_SIZE;

    let newSpeed = 0;
    if (y < topZoneEnd && y > rect.top) { // Check if inside top scroll zone
        const intensity = (topZoneEnd - y) / autoScroller.SCROLL_ZONE_SIZE;
        newSpeed = -Math.max(1, intensity * autoScroller.MAX_SCROLL_SPEED);
    } else if (y > bottomZoneStart && y < rect.bottom) { // Check if inside bottom scroll zone
        const intensity = (y - bottomZoneStart) / autoScroller.SCROLL_ZONE_SIZE;
        newSpeed = Math.max(1, intensity * autoScroller.MAX_SCROLL_SPEED);
    }
    autoScroller.scrollSpeed = newSpeed;

    // Start the animation loop if it's not running and we need to scroll
    if (autoScroller.scrollSpeed !== 0 && !autoScroller.animationFrameId) {
        autoScroller.animationFrameId = requestAnimationFrame(scrollLoop);
    }
}


/**
 * Clears any active drag-and-drop auto-scroll animation frame.
 */
function stopDragAutoScroll() {
    if (autoScroller.animationFrameId) {
        cancelAnimationFrame(autoScroller.animationFrameId);
    }
    autoScroller.animationFrameId = null;
    autoScroller.scrollTarget = null;
    autoScroller.scrollSpeed = 0;
}

/**
 * Adds an array of new song objects to the currently active playlist.
 * @param {object[]} songObjects - An array of song objects from the backend.
 */
export async function addSongsToActivePlaylist(songObjects) {
    if (!songObjects || songObjects.length === 0) return;
    
    const { musicData } = State.getState();
    const activePlaylistName = musicData.activePlaylist;
    const activePlaylistPaths = new Set(musicData.playlists[activePlaylistName] || []);

    const songsToAddToPlaylist = songObjects.filter(song => !activePlaylistPaths.has(song.path));

    if (songsToAddToPlaylist.length === 0) {
        UI.showToast("Selected song(s) already exist in this playlist.", "info");
        return;
    }

    const optimisticAction = () => {
        // --- 1. Backup ---
        const originalPlaylists = JSON.parse(JSON.stringify(State.getState().musicData.playlists));

        // --- 2. Action ---
        const currentMusicData = State.getState().musicData;
        const newSongsMap = { ...currentMusicData.songs };
        const newPathsForPlaylist = [...(currentMusicData.playlists[activePlaylistName] || [])];

        songsToAddToPlaylist.forEach(song => {
            newSongsMap[song.path] = song;
            newPathsForPlaylist.push(song.path);
        });
        
        const newPlaylistsMap = {
            ...currentMusicData.playlists,
            [activePlaylistName]: newPathsForPlaylist
        };
        
        State.addSongsToCache(newSongsMap); // Silently update cache
        State.setPlaylists(newPlaylistsMap); // Publish 'playlists' event
        
        if (State.getState().isShuffling) {
            generateShuffledPlaylist();
        }

        // --- 3. Return Undo Function ---
        return () => {
            // No need to remove songs from cache, just revert playlists
            State.setPlaylists(originalPlaylists);
            if (State.getState().isShuffling) generateShuffledPlaylist();
        };
    };

    const apiCall = () => Api.addSongsToPlaylist(activePlaylistName, songsToAddToPlaylist);

    await State.performOptimisticUpdate(optimisticAction, apiCall, {
        successMessage: `${songsToAddToPlaylist.length} song(s) added to ${activePlaylistName}.`,
        errorMessagePrefix: "Error adding songs"
    });
}

/**
 * Adds an imported playlist to the application state.
 * @param {object} playlistData - The playlist object from the backend {name, paths, songs}.
 */
export function addPlaylistToState(playlistData) {
    if (!playlistData?.name || !playlistData?.paths || !playlistData?.songs) return;

    const { musicData } = State.getState();

    const newSongs = { ...musicData.songs, ...playlistData.songs };
    const newPlaylists = { ...musicData.playlists, [playlistData.name]: playlistData.paths };
    const newPlaylistOrder = [...musicData.playlistOrder, playlistData.name];
    
    State.setMusicData({
        ...musicData,
        songs: newSongs,
        playlists: newPlaylists,
        playlistOrder: newPlaylistOrder
    });
    
    // The order is already saved by the import process on the backend, so no need to call API here.
}


/**
 * Adds the currently selected songs to the end of the play queue.
 */
export async function addSelectedToQueue() {
    const { selectedSongPaths, playQueue } = State.getState();
    const songsToAdd = State.getActivePlaylist()
        .filter(song => selectedSongPaths.includes(song.path) && !song.isMissing);

    if (songsToAdd.length > 0) {
        State.setPlayQueue([...playQueue, ...songsToAdd]);
        const message = songsToAdd.length > 1 ? `${songsToAdd.length} songs added to queue` : `"${songsToAdd[0].name}" added to queue`;
        UI.showToast(message, 'info');
    }
}

/**
 * Adds the currently selected songs to the front of the play queue.
 */
export async function playSelectedNext() {
    const { selectedSongPaths, playQueue } = State.getState();
    const songsToAdd = State.getActivePlaylist()
        .filter(song => selectedSongPaths.includes(song.path) && !song.isMissing);

    if (songsToAdd.length > 0) {
        State.setPlayQueue([...songsToAdd, ...playQueue]);
        const message = songsToAdd.length > 1 ? `${songsToAdd.length} songs will play next` : `"${songsToAdd[0].name}" will play next`;
        UI.showToast(message, 'info');
    }
}

/**
 * Generates and sets a shuffled version of the active playlist.
 * Ensures the currently playing song is placed at the start of the shuffled list.
 */
export function generateShuffledPlaylist() {
    const currentPlaylist = State.getActivePlaylist();
    // Fisher-Yates shuffle
    const shuffled = [...currentPlaylist];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // If a song is playing, move it to the start of the shuffled list
    const { currentSongIndex } = State.getState();
    if (currentSongIndex > -1 && currentPlaylist[currentSongIndex]) { // Check if song exists
        const currentSong = currentPlaylist[currentSongIndex];
        const nowPlayingIndexInShuffle = shuffled.findIndex(s => s.path === currentSong.path);
        if (nowPlayingIndexInShuffle > 0) { // If found and not already at start
            [shuffled[0], shuffled[nowPlayingIndexInShuffle]] = [shuffled[nowPlayingIndexInShuffle], shuffled[0]];
        } else if (nowPlayingIndexInShuffle === -1 && shuffled.length > 0) {
            // If current song somehow not in shuffle (e.g. playlist changed before shuffle), put first song at start
            // This case should be rare if logic is correct elsewhere.
        }
        State.setShuffledIndex(0);
    } else {
        State.setShuffledIndex(-1);
    }
    State.setShuffledPlaylist(shuffled);
}

/**
 * Handles song selection logic for single, ctrl/cmd, and shift clicks.
 * @param {string} clickedPath - The path of the song that was clicked.
 * @param {MouseEvent} event - The click event object.
 */
function handleSongSelection(clickedPath, event) {
    const { selectedSongPaths, lastClickedPath } = State.getState();
    const vListDataSource = UI.getVisibleSongDataSource(); // Get currently visible list
    
    if (event.shiftKey && lastClickedPath) {
        const startIdx = vListDataSource.findIndex(s => s.path === lastClickedPath);
        const endIdx = vListDataSource.findIndex(s => s.path === clickedPath);
        if (startIdx > -1 && endIdx > -1) {
            const start = Math.min(startIdx, endIdx);
            const end = Math.max(startIdx, endIdx);
            State.setSelectedSongPaths(vListDataSource.slice(start, end + 1).map(s => s.path));
        }
    } else if (event.ctrlKey || event.metaKey) {
        const newSelection = new Set(selectedSongPaths);
        if (newSelection.has(clickedPath)) newSelection.delete(clickedPath);
        else newSelection.add(clickedPath);
        State.setSelectedSongPaths(Array.from(newSelection));
        State.setLastClickedPath(clickedPath);
    } else {
        State.setSelectedSongPaths([clickedPath]);
        State.setLastClickedPath(clickedPath);
    }
}

/**
 * Navigates the song list via keyboard.
 * @param {'up' | 'down'} direction - The direction to navigate.
 */
export function navigateSongList(direction) {
    const dataSource = UI.getVisibleSongDataSource();
    if (dataSource.length === 0) return;

    const { lastClickedPath } = State.getState();
    let currentIndex = -1;
    if (lastClickedPath) {
        currentIndex = dataSource.findIndex(s => s.path === lastClickedPath);
    }

    let nextIndex;
    if (direction === 'up') {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    } else { // 'down'
        nextIndex = currentIndex < dataSource.length - 1 ? currentIndex + 1 : dataSource.length - 1;
    }

    if (nextIndex !== currentIndex) {
        const nextSong = dataSource[nextIndex];
        State.setSelectedSongPaths([nextSong.path]);
        State.setLastClickedPath(nextSong.path);
        
        // Scroll into view
        const targetScroll = nextIndex * UI.vList.ITEM_HEIGHT - DOM.songListEl.clientHeight / 2 + UI.vList.ITEM_HEIGHT / 2;
        DOM.songListEl.scrollTop = Math.max(0, targetScroll);
    }
}

/**
 * Switches the active playlist, updating state and resetting player.
 * @param {string} name - The name of the playlist to switch to.
 */
export async function switchPlaylist(name) {
    if (State.getState().musicData.activePlaylist === name) return;

    if (DOM.searchInput.value) {
        DOM.searchInput.value = '';
        DOM.searchClearBtn.classList.add('hidden');
        UI.hideAutocomplete(); // Ensure autocomplete is hidden
    }
    
    State.setActivePlaylist(name);
    State.setViewMode('playlist');
    State.setCurrentSongIndex(-1);
    State.setSelectedSongPaths([]);
    State.setLastClickedPath(null);
    State.setPlayQueue([]);

    if (State.getState().isShuffling) generateShuffledPlaylist();
    
    try {
        await Api.saveActivePlaylist(name);
    } catch (e) {
        // Non-critical, but log it. UI has already switched.
        console.error(`Failed to save active playlist to backend: ${e.message}`);
        // No UI rollback needed here as it's a preference save.
    }


    // Stop and unload the current song
    const audioPlayer = Player.getAudioPlayer();
    if (audioPlayer.src) {
        audioPlayer.pause();
        audioPlayer.src = '';
    }
    // Player UI reset is now handled by the 'currentSongIndex' subscription
}

/**
 * Initiates the process to rename a playlist.
 * @param {string} oldName - The current name of the playlist.
 * @param {HTMLElement} itemElement - The list item element for the playlist.
 */
async function renamePlaylist(oldName, itemElement) {
    if (oldName === 'Default') {
        UI.showToast("Cannot rename the Default playlist.", 'error');
        return;
    }
    
    let isFinalizing = false; // Flag to prevent double execution

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    itemElement.innerHTML = '';
    itemElement.appendChild(input);
    input.focus();
    input.select();

    const finalize = async () => {
        if (isFinalizing) return;
        isFinalizing = true;
        
        const newName = input.value.trim();

        if (!newName || newName === oldName) {
            UI.renderPlaylists();
            return;
        }

        if (State.getState().musicData.playlists[newName]) {
            UI.showToast("A playlist with this name already exists.", 'error');
            UI.renderPlaylists(); 
            return;
        }
        
        const optimisticAction = () => {
            // --- 1. Backup ---
            const { musicData } = State.getState();
            const originalPlaylists = { ...musicData.playlists };
            const originalOrder = [...musicData.playlistOrder];
            const originalActivePlaylist = musicData.activePlaylist;

            // --- 2. Action ---
            const optimisticPlaylists = { ...musicData.playlists, [newName]: musicData.playlists[oldName] };
            delete optimisticPlaylists[oldName];
            const optimisticOrder = musicData.playlistOrder.map(n => n === oldName ? newName : n);
            let optimisticActivePlaylist = musicData.activePlaylist;
            if (musicData.activePlaylist === oldName) {
                optimisticActivePlaylist = newName;
            }
            State.setActivePlaylist(optimisticActivePlaylist);
            State.setPlaylistOrder(optimisticOrder);
            State.setPlaylists(optimisticPlaylists);

            // --- 3. Return Undo Function ---
            return () => {
                State.setActivePlaylist(originalActivePlaylist);
                State.setPlaylistOrder(originalOrder);
                State.setPlaylists(originalPlaylists);
            };
        };

        const apiCall = () => Api.renamePlaylist(oldName, newName);

        await State.performOptimisticUpdate(optimisticAction, apiCall, {
            successMessage: `Playlist renamed to "${newName}"`,
            errorMessagePrefix: "Error renaming playlist"
        });
    };
    
    input.addEventListener('blur', finalize);
    input.addEventListener('keydown', e => { if(e.key === 'Enter') input.blur(); });
}

/**
 * Initiates the process to delete a playlist after confirmation.
 * @param {string} name - The name of the playlist to delete.
 */
async function deletePlaylist(name) {
    if (name === 'Default') {
        UI.showToast("Cannot delete the Default playlist.", 'error');
        return;
    }
    
    const confirmed = await UI.showConfirmation(`Delete the playlist "${name}"? Songs that only exist in this playlist will be permanently deleted from your library and computer. This cannot be undone.`);
    if (!confirmed) return;

    const wasPlayingInDeletedPlaylist = State.getState().musicData.activePlaylist === name;
    
    const optimisticAction = () => {
        // --- 1. Backup ---
        const { musicData, playQueue, currentSongIndex } = State.getState();
        const originalPlaylists = JSON.parse(JSON.stringify(musicData.playlists));
        const originalPlaylistOrder = [...musicData.playlistOrder];
        const originalActivePlaylist = musicData.activePlaylist;
        const originalPlayQueue = [...playQueue];

        // --- 2. Action ---
        const optimisticPlaylists = { ...musicData.playlists };
        delete optimisticPlaylists[name];
        const optimisticPlaylistOrder = musicData.playlistOrder.filter(n => n !== name);
        
        if (wasPlayingInDeletedPlaylist) {
            State.setActivePlaylist('Default');
            State.setViewMode('playlist');
            State.setCurrentSongIndex(-1);
            State.setSelectedSongPaths([]);
            State.setLastClickedPath(null);
            State.setPlayQueue([]);
            if (Player.getAudioPlayer().src) {
                Player.getAudioPlayer().pause();
                Player.getAudioPlayer().src = '';
            }
        }
        
        State.setPlaylistOrder(optimisticPlaylistOrder);
        State.setPlaylists(optimisticPlaylists); 

        // --- 3. Return Undo Function ---
        return () => {
            State.setPlaylists(originalPlaylists);
            State.setPlaylistOrder(originalPlaylistOrder);
            State.setActivePlaylist(originalActivePlaylist);
            State.setPlayQueue(originalPlayQueue);
            if (wasPlayingInDeletedPlaylist) {
                State.setCurrentSongIndex(currentSongIndex);
            }
        };
    };

    const apiCall = async () => {
        await Api.deletePlaylist(name);
        if (wasPlayingInDeletedPlaylist) {
            await Api.saveActivePlaylist('Default');
        }
    };

    await State.performOptimisticUpdate(optimisticAction, apiCall, {
        successMessage: `Playlist "${name}" deleted.`,
        errorMessagePrefix: "Error deleting playlist",
        playerWasReset: wasPlayingInDeletedPlaylist
    });
}

/**
 * Removes the currently selected songs from the queue.
 */
export function removeSelectedFromQueue() {
    const { selectedSongPaths, playQueue } = State.getState();
    if (selectedSongPaths.length === 0) return;

    State.setPlayQueue(playQueue.filter(song => !selectedSongPaths.includes(song.path)));
    State.setSelectedSongPaths([]);
    State.setLastClickedPath(null);
}

/**
 * Permanently deletes the selected songs after confirmation.
 */
export async function deleteSelectedSongs() {
    const { selectedSongPaths } = State.getState();
    if (selectedSongPaths.length === 0) return;

    const firstSongName = State.getState().musicData.songs[selectedSongPaths[0]]?.name || 'this song';
    const message = selectedSongPaths.length > 1
        ? `Permanently delete ${selectedSongPaths.length} songs from your library and computer? This cannot be undone.`
        : `Permanently delete "${firstSongName}"? This cannot be undone.`;

    const confirmed = await UI.showConfirmation(message);
    if (!confirmed) return;

    const playingSong = State.getActivePlaylist()[State.getState().currentSongIndex];
    const wasPlayingSongDeleted = playingSong?.path && selectedSongPaths.includes(playingSong.path);

    const optimisticAction = () => {
        // --- 1. Backup ---
        const { musicData, playQueue, currentSongIndex, isShuffling } = State.getState();
        const deletedSongObjects = {};
        selectedSongPaths.forEach(path => {
            if (musicData.songs[path]) {
                deletedSongObjects[path] = musicData.songs[path];
            }
        });
        const originalPlaylists = JSON.parse(JSON.stringify(musicData.playlists));
        const originalPlayQueue = [...playQueue];

        // --- 2. Action ---
        const newSongsMap = { ...musicData.songs };
        selectedSongPaths.forEach(path => { delete newSongsMap[path]; });

        const newPlaylistsMap = {};
        for (const [pName, pPaths] of Object.entries(musicData.playlists)) {
            newPlaylistsMap[pName] = pPaths.filter(path => !selectedSongPaths.includes(path));
        }

        const newMusicData = { ...musicData, songs: newSongsMap, playlists: newPlaylistsMap };
        State.setMusicData(newMusicData);
        
        const optimisticPlayQueue = playQueue.filter(song => !selectedSongPaths.includes(song.path));
        let optimisticCurrentSongIndex = currentSongIndex;

        if (wasPlayingSongDeleted) {
            Player.getAudioPlayer().pause();
            Player.getAudioPlayer().src = '';
            optimisticCurrentSongIndex = -1;
        } else if (playingSong) {
            const newActivePlaylistPaths = newMusicData.playlists[musicData.activePlaylist];
            optimisticCurrentSongIndex = newActivePlaylistPaths.findIndex(p => p === playingSong.path);
        }
        
        State.setPlayQueue(optimisticPlayQueue);
        State.setCurrentSongIndex(optimisticCurrentSongIndex);
        State.setSelectedSongPaths([]);
        State.setLastClickedPath(null);
        if (isShuffling) generateShuffledPlaylist();

        // --- 3. Return Undo Function ---
        return () => {
            const restoredMusicData = {
                ...State.getState().musicData,
                songs: { ...State.getState().musicData.songs, ...deletedSongObjects },
                playlists: originalPlaylists
            };
            State.setMusicData(restoredMusicData);
            State.setPlayQueue(originalPlayQueue);
            State.setCurrentSongIndex(currentSongIndex);
            if (isShuffling) generateShuffledPlaylist();
        };
    };

    const apiCall = () => Api.deleteSongs(selectedSongPaths);

    await State.performOptimisticUpdate(optimisticAction, apiCall, {
        successMessage: `${selectedSongPaths.length} song(s) deleted.`,
        errorMessagePrefix: "Error deleting songs",
        playerWasReset: wasPlayingSongDeleted
    });
}

/**
 * Handles the drop event when reordering songs within a list.
 * @param {DragEvent} e - The drop event.
 */
async function handleSongReorderDrop(e) {
    const { selectedSongPaths, viewMode } = State.getState();
    if (selectedSongPaths.length === 0) return;

    const containerRect = DOM.songListEl.getBoundingClientRect();
    const relativeY = e.clientY - containerRect.top + DOM.songListEl.scrollTop;
    let targetIndex = Math.round(relativeY / UI.vList.ITEM_HEIGHT);

    if (viewMode === 'queue') {
        const originalQueue = [...State.getState().playQueue];
        targetIndex = Math.max(0, Math.min(targetIndex, originalQueue.length));
        const songsToMove = originalQueue.filter(s => selectedSongPaths.includes(s.path));
        const remainingSongs = originalQueue.filter(s => !selectedSongPaths.includes(s.path));
        
        const movedItemsBeforeTarget = originalQueue.slice(0, targetIndex).filter(s => selectedSongPaths.includes(s.path)).length;
        remainingSongs.splice(targetIndex - movedItemsBeforeTarget, 0, ...songsToMove);
        State.setPlayQueue(remainingSongs); // Optimistic (no API call for queue reorder)
    } else { // 'playlist' mode
        const currentPlaylistName = State.getState().musicData.activePlaylist;
        const originalPlaylistPaths = [...(State.getState().musicData.playlists[currentPlaylistName] || [])];
        targetIndex = Math.max(0, Math.min(targetIndex, originalPlaylistPaths.length));

        const songsToMovePaths = originalPlaylistPaths.filter(path => selectedSongPaths.includes(path));
        const remainingPaths = originalPlaylistPaths.filter(path => !selectedSongPaths.includes(path));
        
        const movedItemsBeforeTarget = originalPlaylistPaths.slice(0, targetIndex).filter(path => selectedSongPaths.includes(path)).length;
        const newOrderedPaths = [...remainingPaths];
        newOrderedPaths.splice(targetIndex - movedItemsBeforeTarget, 0, ...songsToMovePaths);
        
        const optimisticAction = () => {
            // --- 1. Backup ---
            const originalPaths = State.getState().musicData.playlists[currentPlaylistName];

            // --- 2. Action ---
            const currentMusicData = State.getState().musicData;
            const optimisticPlaylists = { 
                ...currentMusicData.playlists, 
                [currentPlaylistName]: newOrderedPaths 
            };
            State.setPlaylists(optimisticPlaylists);
            if (State.getState().isShuffling) generateShuffledPlaylist();

            // --- 3. Return Undo Function ---
            return () => {
                const currentData = State.getState().musicData;
                const restoredPlaylists = { ...currentData.playlists, [currentPlaylistName]: originalPaths };
                State.setPlaylists(restoredPlaylists);
                if (State.getState().isShuffling) generateShuffledPlaylist();
            };
        };

        const apiCall = () => Api.reorderPlaylistSongs(currentPlaylistName, newOrderedPaths);

        await State.performOptimisticUpdate(optimisticAction, apiCall, {
            errorMessagePrefix: "Failed to save song order"
        });
    }
}

/**
 * Handles reordering of selected songs in the current list via keyboard.
 * @param {'up' | 'down'} direction - The direction to move the songs.
 */
export async function reorderSelectedSongsInList(direction) {
    const { viewMode, playQueue, musicData, selectedSongPaths } = State.getState();
    if (selectedSongPaths.length === 0) return;
    
    const dataSource = viewMode === 'queue' ? playQueue : State.getActivePlaylist();
    if (dataSource.length < 2) return;

    const songsToMove = dataSource.filter(s => selectedSongPaths.includes(s.path));
    const remainingItems = dataSource.filter(s => !selectedSongPaths.includes(s.path));

    // Get original indices of items to move and sort them
    const originalIndices = songsToMove.map(song => dataSource.indexOf(song)).sort((a,b) => a-b);
    const firstIndex = originalIndices[0];
    const lastIndex = originalIndices[originalIndices.length - 1];

    if (direction === 'up' && firstIndex === 0) return;
    if (direction === 'down' && lastIndex === dataSource.length - 1) return;

    let insertionIndex;

    if (direction === 'up') {
        // Find the item that was originally before the selection block
        const itemToMoveBefore = dataSource[firstIndex - 1];
        // Find its new index in the list of remaining items
        insertionIndex = remainingItems.indexOf(itemToMoveBefore);
    } else { // 'down'
        // Find item originally after selection block
        const itemToMoveAfter = dataSource[lastIndex + 1];
        // Its new index + 1 is our insertion point
        insertionIndex = remainingItems.indexOf(itemToMoveAfter) + 1;
    }

    remainingItems.splice(insertionIndex, 0, ...songsToMove);
    const newItems = remainingItems;

    // Ensure the moved items remain selected and visible
    const newFirstIndex = newItems.findIndex(s => s.path === songsToMove[0].path);
    if (newFirstIndex > -1) {
        const targetScroll = newFirstIndex * UI.vList.ITEM_HEIGHT - DOM.songListEl.clientHeight / 2 + UI.vList.ITEM_HEIGHT / 2;
        DOM.songListEl.scrollTop = Math.max(0, targetScroll);
    }
    
    if (viewMode === 'queue') {
        State.setPlayQueue(newItems);
    } else {
        const newPaths = newItems.map(s => s.path);
        const currentPlaylistName = musicData.activePlaylist;
        
        const optimisticAction = () => {
            // --- 1. Backup ---
            const originalPaths = State.getState().musicData.playlists[currentPlaylistName];

            // --- 2. Action ---
            const currentMusicData = State.getState().musicData;
            const optimisticPlaylists = { ...currentMusicData.playlists, [currentPlaylistName]: newPaths };
            State.setPlaylists(optimisticPlaylists);
            if (State.getState().isShuffling) generateShuffledPlaylist();

            // --- 3. Return Undo Function ---
            return () => {
                const currentData = State.getState().musicData;
                const restoredPlaylists = { ...currentData.playlists, [currentPlaylistName]: originalPaths };
                State.setPlaylists(restoredPlaylists);
                if (State.getState().isShuffling) generateShuffledPlaylist();
            };
        };

        const apiCall = () => Api.reorderPlaylistSongs(currentPlaylistName, newPaths);

        await State.performOptimisticUpdate(optimisticAction, apiCall, {
            errorMessagePrefix: "Failed to save song order"
        });
    }
}

/**
 * Cycles to the next or previous playlist.
 * @param {'next'|'prev'} direction The direction to cycle.
 */
export function cyclePlaylist(direction) {
    const { musicData } = State.getState();
    const { playlistOrder, activePlaylist } = musicData;
    if (playlistOrder.length < 2) return;

    const currentIndex = playlistOrder.indexOf(activePlaylist);
    let nextIndex;
    if (direction === 'next') {
        nextIndex = (currentIndex + 1) % playlistOrder.length;
    } else { // 'prev'
        nextIndex = (currentIndex - 1 + playlistOrder.length) % playlistOrder.length;
    }

    const nextPlaylist = playlistOrder[nextIndex];
    if (nextPlaylist) {
        switchPlaylist(nextPlaylist);
    }
}

/**
 * Opens a prompt to create a new playlist.
 */
export async function createNewPlaylist() {
    DOM.addPlaylistPopover.classList.add('hidden');
        
    const newNameRaw = await UI.showPrompt('Enter a name for the new playlist.', {
        title: 'Create Playlist',
        defaultValue: 'New Playlist',
        okText: 'Create',
        validator: (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                return 'Playlist name cannot be empty.';
            }
            if (State.getState().musicData.playlists[trimmed]) {
                return 'A playlist with this name already exists.';
            }
            return null; // All good
        }
    });

    if (newNameRaw === null) return; // User cancelled

    const newName = newNameRaw.trim();
    
    const optimisticAction = () => {
        // --- 1. Backup ---
        const { musicData } = State.getState();
        const originalPlaylists = musicData.playlists;
        const originalOrder = musicData.playlistOrder;
        
        // --- 2. Action ---
        const optimisticOrder = [...musicData.playlistOrder, newName];
        State.setPlaylists({ ...musicData.playlists, [newName]: [] }); 
        State.setPlaylistOrder(optimisticOrder); 

        // --- 3. Return Undo ---
        return () => {
            State.setPlaylists(originalPlaylists);
            State.setPlaylistOrder(originalOrder);
        };
    };

    // Note: The API call reorders all playlists, which implicitly creates the new one if it doesn't exist.
    const apiCall = () => Api.reorderPlaylists(State.getState().musicData.playlistOrder);
    
    await State.performOptimisticUpdate(optimisticAction, apiCall, {
        successMessage: `Playlist "${newName}" created.`,
        errorMessagePrefix: "Failed to save new playlist"
    });
}

/**
 * Initializes all event listeners related to playlists and song lists.
 */
export function initPlaylistEventListeners() {
    // --- Song List Event Delegation ---
    DOM.songListEl.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-path]');
        if (li) handleSongSelection(li.dataset.path, e);
    });

    DOM.songListEl.addEventListener('dblclick', (e) => {
        const li = e.target.closest('li[data-path]');
        if (!li) return;
        const { viewMode, playQueue, searchMode } = State.getState();
        
        if (searchMode === 'global') {
            const song = UI.getVisibleSongDataSource().find(s => s.path === li.dataset.path);
            if (song && !song.isMissing) {
                State.setSearchMode('filter'); // Switch back to filter mode first
                const { musicData } = State.getState();
                let foundInPlaylist = musicData.activePlaylist;
                if (!musicData.playlists[foundInPlaylist]?.some(path => path === song.path)) {
                    foundInPlaylist = musicData.playlistOrder.find(name => musicData.playlists[name].some(path => path === song.path)) || 'Default';
                }
                
                (async () => {
                    if (State.getState().musicData.activePlaylist !== foundInPlaylist) {
                        await switchPlaylist(foundInPlaylist);
                    }
                    const index = State.getActivePlaylist().findIndex(s => s.path === song.path);
                    if (index > -1) Player.playSongByIndex(index, { clearQueue: true });
                })();
            } else if (song?.isMissing) {
                UI.showToast(`File for "${song.name}" is missing.`, 'error');
            }
            return;
        }

        const dataSource = viewMode === 'queue' ? playQueue : State.getActivePlaylist();
        const index = dataSource.findIndex(s => s.path === li.dataset.path);
        if (index === -1) return;

        if (viewMode === 'queue') {
            State.setPlayQueue(dataSource.slice(index)); // Play from this song onwards in queue
            Player.playNextSong(); // This will pick the new first song in queue
        } else {
            Player.playSongByIndex(index, { clearQueue: true });
        }
    });

    DOM.songListEl.addEventListener('contextmenu', (e) => {
        const li = e.target.closest('li[data-path]');
        if (!li) { UI.hideSongContextMenu(); return; }
        
        e.preventDefault();
        e.stopPropagation();
        UI.hideSongTooltip();
        
        // If right-clicked item is not in selection, reset selection to just this item
        if (!State.getState().selectedSongPaths.includes(li.dataset.path)) {
            State.setSelectedSongPaths([li.dataset.path]);
            State.setLastClickedPath(li.dataset.path);
        }
        UI.showSongContextMenu(e);
    });

    // --- Song Tooltip Hover Logic ---
    let tooltipTimer = null, currentHoverTarget = null;

    // Immediately hide tooltip on scroll or mousedown to prevent it from appearing during these actions.
    DOM.songListEl.addEventListener('scroll', () => {
        clearTimeout(tooltipTimer);
        UI.hideSongTooltip();
    }, { passive: true });
    
    DOM.songListEl.addEventListener('mousedown', () => {
        clearTimeout(tooltipTimer);
        UI.hideSongTooltip();
    });

    DOM.songListEl.addEventListener('mouseover', (e) => {
        const li = e.target.closest('li[data-path]');
        if (!li || li === currentHoverTarget) return;

        currentHoverTarget = li;
        clearTimeout(tooltipTimer);
        UI.hideSongTooltip();

        // Abort setting a new timer if an action is already in progress.
        if (document.querySelector('.modal-overlay.visible') ||
            !DOM.songContextMenu.classList.contains('hidden') ||
            !DOM.playlistContextMenu.classList.contains('hidden') ||
            State.getState().draggedElement) {
            return;
        }

        tooltipTimer = setTimeout(() => {
            // Final check right before showing: Abort if an action has started
            // or if the mouse has moved to another item during the delay.
            if (li !== currentHoverTarget || // ensures we're still on the same item
                document.querySelector('.modal-overlay.visible') ||
                !DOM.songContextMenu.classList.contains('hidden') ||
                !DOM.playlistContextMenu.classList.contains('hidden') ||
                State.getState().draggedElement) {
                return;
            }

            const { viewMode, playQueue } = State.getState();
            const dataSource = viewMode === 'queue' ? playQueue : State.getActivePlaylist();
            const song = dataSource.find(s => s.path === li.dataset.path);
            if (song) UI.showSongTooltip(song, e);
        }, 500);
    });

    DOM.songListEl.addEventListener('mouseleave', () => {
        clearTimeout(tooltipTimer);
        UI.hideSongTooltip();
        currentHoverTarget = null;
    });

    // --- Playlist Management ---
    DOM.addPlaylistBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const popover = DOM.addPlaylistPopover;
        if (popover.classList.contains('hidden')) {
            UI.hideSongContextMenu();
            UI.hidePlaylistContextMenu();
            UI.positionPopup(popover, DOM.addPlaylistBtn, { position: 'below', align: 'right' });
            feather.replace({ width: '1em', height: '1em' });
        } else {
            popover.classList.add('hidden');
        }
    });
    
    DOM.createNewPlaylistBtn.addEventListener('click', createNewPlaylist);
    
    DOM.importPlaylistBtn.addEventListener('click', async () => {
        DOM.addPlaylistPopover.classList.add('hidden');
        const persistentToast = UI.showToast('Importing playlist...', 'info', 0);
        try {
            const response = await Api.importPlaylist();
            if (response.status === 'success' && response.playlist) {
                addPlaylistToState(response.playlist);
                UI.showToast(`Playlist "${response.playlist.name}" imported.`, 'success');
            } else if (response.status !== 'cancelled') {
                 UI.showToast('Failed to import playlist.', 'error');
            }
        } catch (e) {
            console.error('Failed to import playlist:', e);
            UI.showToast(`Error: ${e.message}`, 'error');
        } finally {
            if (persistentToast) persistentToast.remove();
        }
    });

    // --- Drag and Drop ---
    document.addEventListener('dragstart', (e) => {
        const target = e.target;
        UI.hideSongTooltip();
        if (target.matches('#song-list li[data-path]')) {
            let { selectedSongPaths } = State.getState();
            if (!selectedSongPaths.includes(target.dataset.path)) {
                State.setSelectedSongPaths([target.dataset.path]);
                State.setLastClickedPath(target.dataset.path);
                selectedSongPaths = [target.dataset.path]; // Update local var for immediate use
            }

            if (selectedSongPaths.length > 1) {
                const dragPreview = document.createElement('div');
                dragPreview.className = 'drag-preview';
                dragPreview.innerHTML = `<i data-feather="music"></i><span>${selectedSongPaths.length} songs</span>`;
                document.body.appendChild(dragPreview);
                feather.replace({ width: '1em', height: '1em' });
                
                e.dataTransfer.setDragImage(dragPreview, 10, 10);
                
                setTimeout(() => document.body.removeChild(dragPreview), 0);
            }

            State.setDraggedElement(target);
            setTimeout(() => { 
                selectedSongPaths.forEach(path => {
                    DOM.songListEl.querySelector(`li[data-path="${path}"]`)?.classList.add('dragging');
                });
            }, 0);
        } else if (target.matches('#playlist-list .playlist-list-item')) {
            State.setDraggedElement(target);
            cachedDraggablePlaylists = [...DOM.playlistList.querySelectorAll('.playlist-list-item')];
            setTimeout(() => target.classList.add('dragging'), 0);
        }
    });

    document.addEventListener('dragend', () => {
        stopDragAutoScroll();
        if (State.getState().draggedElement) {
            document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
            State.setDraggedElement(null);
            UI.hideDropIndicator();
            UI.hidePlaylistDropIndicator();
            cachedDraggablePlaylists = null;
        }
    });

    DOM.songListEl.addEventListener('dragover', (e) => {
        const { draggedElement } = State.getState();
        if (draggedElement?.matches('#song-list li')) {
            e.preventDefault();
            UI.showDropIndicator(e.clientY);
            handleDragAutoScroll(e, DOM.songListEl);
        }
    });

    DOM.songListEl.addEventListener('dragleave', (e) => {
        stopDragAutoScroll();
        if (e.target === DOM.songListEl || !DOM.songListEl.contains(e.relatedTarget)) UI.hideDropIndicator();
    });

    DOM.songListEl.addEventListener('drop', (e) => {
        e.preventDefault();
        stopDragAutoScroll();
        UI.hideDropIndicator();
        const { draggedElement } = State.getState();
        if (draggedElement?.matches('#song-list li')) {
            handleSongReorderDrop(e);
        }
    });

    // --- Playlist List Event Delegation ---
    DOM.playlistList.addEventListener('click', e => {
        const item = e.target.closest('.playlist-list-item');
        if (item && e.target.tagName !== 'INPUT') switchPlaylist(item.dataset.playlistName);
    });

    DOM.playlistList.addEventListener('contextmenu', e => {
        const item = e.target.closest('.playlist-list-item');
        if (item && item.dataset.playlistName !== 'Default') {
            e.preventDefault();
            e.stopPropagation();
            UI.showPlaylistContextMenu(e, item.dataset.playlistName);
        }
    });
    
    DOM.playlistList.addEventListener('dragover', e => {
        const { draggedElement, musicData } = State.getState();
        if (!draggedElement) return;
        e.preventDefault();
        handleDragAutoScroll(e, DOM.playlistList);
        DOM.playlistList.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));

        if (draggedElement.matches('.playlist-list-item')) {
            const filteredCache = cachedDraggablePlaylists ? cachedDraggablePlaylists.filter(el => el !== draggedElement) : null;
            UI.showPlaylistDropIndicator(e.clientY, filteredCache);
        } else if (draggedElement.matches('#song-list li')) {
            const targetItem = e.target.closest('.playlist-list-item');
            if (targetItem && targetItem.dataset.playlistName !== musicData.activePlaylist) {
                targetItem.classList.add('drop-target');
            }
        }
    });

    DOM.playlistList.addEventListener('dragleave', e => {
        stopDragAutoScroll();
        e.target.closest('.playlist-list-item')?.classList.remove('drop-target');
        if (!e.currentTarget.contains(e.relatedTarget)) UI.hidePlaylistDropIndicator();
    });

    DOM.playlistList.addEventListener('drop', async e => {
        e.preventDefault();
        stopDragAutoScroll();
        const { draggedElement } = State.getState();
        if (!draggedElement) return;

        // Reorder playlists
        if (draggedElement.matches('.playlist-list-item')) {
            UI.hidePlaylistDropIndicator();
            const sourceName = draggedElement.dataset.playlistName;
            const afterElement = UI.getDragAfterElement(DOM.playlistList, e.clientY, '.playlist-list-item:not(.dragging)');
            const targetName = afterElement ? afterElement.dataset.playlistName : null;
            
            const optimisticOrder = [...State.getState().musicData.playlistOrder];
            const [movedItem] = optimisticOrder.splice(optimisticOrder.indexOf(sourceName), 1);
            const targetIndex = targetName ? optimisticOrder.indexOf(targetName) : optimisticOrder.length;
            optimisticOrder.splice(targetIndex, 0, movedItem);
            
            const optimisticAction = () => {
                const originalOrder = [...State.getState().musicData.playlistOrder];
                State.setPlaylistOrder(optimisticOrder);
                return () => State.setPlaylistOrder(originalOrder);
            };
            const apiCall = () => Api.reorderPlaylists(optimisticOrder);

            await State.performOptimisticUpdate(optimisticAction, apiCall, {
                errorMessagePrefix: "Failed to save playlist order"
            });
        }
        // Drop song on a playlist
        else if (draggedElement.matches('#song-list li')) {
            const dropTargetItem = e.target.closest('.playlist-list-item.drop-target');
            if (dropTargetItem) {
                dropTargetItem.classList.remove('drop-target');
                const { selectedSongPaths } = State.getState();
                const sourcePlaylistName = State.getState().musicData.activePlaylist;
                const targetPlaylistName = dropTargetItem.dataset.playlistName;

                const optimisticAction = () => {
                    // --- 1. Backup ---
                    const { musicData, playQueue } = State.getState();
                    const originalPlaylists = JSON.parse(JSON.stringify(musicData.playlists));
                    const originalPlayQueue = [...playQueue];

                    // --- 2. Action ---
                    const newPlaylistsMap = JSON.parse(JSON.stringify(musicData.playlists));
    
                    const sourcePaths = newPlaylistsMap[sourcePlaylistName];
                    const targetPaths = newPlaylistsMap[targetPlaylistName];
                    
                    newPlaylistsMap[sourcePlaylistName] = sourcePaths.filter(p => !selectedSongPaths.includes(p));
                    const uniquePathsToAdd = selectedSongPaths.filter(p => !targetPaths.includes(p));
                    newPlaylistsMap[targetPlaylistName] = targetPaths.concat(uniquePathsToAdd);
    
                    State.setMusicData({ ...musicData, playlists: newPlaylistsMap });
                    State.setPlayQueue(playQueue.filter(s => !selectedSongPaths.includes(s.path)));
                    State.setSelectedSongPaths([]);

                    // --- 3. Return Undo ---
                    return () => {
                        State.setMusicData({ ...State.getState().musicData, playlists: originalPlaylists });
                        State.setPlayQueue(originalPlayQueue);
                    };
                };

                const apiCall = () => Api.moveSongsToPlaylist(sourcePlaylistName, targetPlaylistName, selectedSongPaths);

                await State.performOptimisticUpdate(optimisticAction, apiCall, {
                    successMessage: `Moved ${selectedSongPaths.length} song(s) to ${targetPlaylistName}.`,
                    errorMessagePrefix: "Failed to move songs"
                });
            }
        }
    });

    // --- Playlist Context Menu Actions ---
    DOM.playlistRenameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.hidePlaylistContextMenu();
        const targetName = State.getState().contextMenuTarget;
        if (targetName) {
            const item = [...DOM.playlistList.querySelectorAll('.playlist-list-item')].find(i => i.dataset.playlistName === targetName);
            if (item) renamePlaylist(targetName, item);
        }
    });

    DOM.playlistExportBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent the global click handler from closing the new popover immediately
        UI.positionPopup(DOM.exportPlaylistPopover, DOM.playlistExportBtn, { position: 'right' });
        feather.replace({ width: '1em', height: '1em' });
    });

    DOM.exportFnlistBtn.addEventListener('click', async () => {
        DOM.exportPlaylistPopover.classList.add('hidden');
        UI.hidePlaylistContextMenu();
        const targetName = State.getState().contextMenuTarget;
        if (!targetName) return;

        const persistentToast = UI.showToast(`Exporting "${targetName}"...`, 'info', 0);
        try {
            const response = await Api.exportPlaylist(targetName);
            if (response.status === 'success') {
                UI.showToast(`Playlist "${targetName}" exported successfully.`, 'success');
            } else if (response.status !== 'cancelled') {
                UI.showToast('Failed to export playlist.', 'error');
            }
        } catch (e) {
            console.error('Failed to export playlist:', e);
            UI.showToast(`Error: ${e.message}`, 'error');
        } finally {
            if (persistentToast) persistentToast.remove();
        }
    });

    DOM.exportM3uBtn.addEventListener('click', async () => {
        DOM.exportPlaylistPopover.classList.add('hidden');
        UI.hidePlaylistContextMenu();
        const targetName = State.getState().contextMenuTarget;
        if (!targetName) return;

        const persistentToast = UI.showToast(`Exporting "${targetName}" as .m3u...`, 'info', 0);
        try {
            const response = await Api.exportPlaylistAsM3U(targetName);
            if (response.status === 'success') {
                UI.showToast(`Playlist "${targetName}" exported as M3U.`, 'success');
            } else if (response.status !== 'cancelled') {
                UI.showToast('Failed to export playlist as M3U.', 'error');
            }
        } catch (e) {
            console.error('Failed to export M3U playlist:', e);
            UI.showToast(`Error: ${e.message}`, 'error');
        } finally {
            if (persistentToast) persistentToast.remove();
        }
    });

    DOM.playlistDeleteBtn.addEventListener('click', () => {
        UI.hidePlaylistContextMenu();
        const targetName = State.getState().contextMenuTarget;
        if (targetName) deletePlaylist(targetName);
    });
}