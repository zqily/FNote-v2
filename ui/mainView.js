/**
 * @module ui/mainView
 * Handles core rendering functions for the main UI, including player, playlists, and view modes.
 */

import * as DOM from '../dom.js';
import * as State from '../state.js';
import * as Api from '../api.js';
import { getDragAfterElement, setIcon } from '../utils.js';
import { renderSongList } from './virtualList.js';

// --- Playlist Drag-and-Drop State ---
const pList = {
    dropIndicator: null
};

export function setPlayPauseIcon(iconName) {
    setIcon(DOM.playPauseBtn, iconName);
}

export function updateVolumeIcon(volume) {
    const state = volume === 0 ? 'mute' : volume < 50 ? 'low' : 'high';
    DOM.volumeIcon.classList.remove('volume-state-mute', 'volume-state-low', 'volume-state-high');
    DOM.volumeIcon.classList.add(`volume-state-${state}`);
}

export function updateShuffleButtonUI() {
    DOM.shuffleBtn.classList.toggle('active', State.getState().isShuffling);
}

export function updateRepeatButtonUI() {
    const { loopMode } = State.getState();
    DOM.repeatBtn.classList.toggle('active', loopMode !== 'none');
    let one = DOM.repeatBtn.querySelector('.repeat-one');
    if (loopMode === 'song' && !one) {
        one = document.createElement('span');
        one.className = 'repeat-one';
        one.textContent = '1';
        DOM.repeatBtn.appendChild(one);
    } else if (loopMode !== 'song' && one) {
        one.remove();
    }
}

function setAccentColors(colorObj) {
    const props = colorObj ? {
        '--accent-color': `rgb(${colorObj.r}, ${colorObj.g}, ${colorObj.b})`,
        '--accent-hover': `rgb(${[colorObj.r, colorObj.g, colorObj.b].map(c => Math.min(255, c + 20)).join(',')})`,
        '--glow-color': `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, 0.7)`,
        '--accent-bg-glow': `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, 0.15)`,
        '--accent-selection-bg': `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, 0.2)`
    } : { /* Reset properties */
        '--accent-color': '', '--accent-hover': '', '--glow-color': '',
        '--accent-bg-glow': '', '--accent-selection-bg': ''
    };
    for (const [prop, value] of Object.entries(props)) {
        document.body.style.setProperty(prop, value);
    }
}

export async function updatePlayerInfo(song) {
    DOM.currentSongTitle.textContent = song.name || 'Untitled';
    DOM.currentSongArtist.textContent = song.artist || 'Unknown Artist';

    const cachedCover = State.getCoverFromCache(song.path);
    let coverDataToUse = cachedCover;

    // If cover data is not cached, fetch it
    if (!coverDataToUse && song.coverPath) {
        coverDataToUse = await Api.getCoverData(song.path).catch(() => null);
        if (coverDataToUse) {
            State.setCoverInCache(song.path, coverDataToUse);
        }
    }

    if (coverDataToUse) {
        DOM.albumArtImg.src = coverDataToUse;
        DOM.albumArtImg.classList.remove('hidden');
        DOM.albumArtPlaceholder.classList.add('hidden');
        // If accent color is cached, use it. Otherwise, kick off background generation.
        if (song.accentColor) {
            setAccentColors(song.accentColor);
        } else {
            setAccentColors(null); // Use default colors while generating
            Api.generateAccentColor(song.path); // Fire-and-forget
        }
    } else {
        DOM.albumArtImg.src = '';
        DOM.albumArtImg.classList.add('hidden');
        DOM.albumArtPlaceholder.classList.remove('hidden');
        setAccentColors(null);
    }
}

export function resetPlayerUI() {
    DOM.currentSongTitle.textContent = "No Song Selected";
    DOM.currentSongArtist.textContent = "Select a song to play";
    setPlayPauseIcon('play');
    DOM.playerPanel.classList.remove('is-playing');
    DOM.seekBar.value = 0;
    DOM.currentTimeEl.textContent = "00:00";
    DOM.totalDurationEl.textContent = "00:00";
    DOM.albumArtImg.classList.add('hidden');
    DOM.albumArtImg.src = '';
    DOM.albumArtPlaceholder.classList.remove('hidden');
    DOM.markerContainer.innerHTML = '';
    setAccentColors(null);
}

export function toggleViewMode() {
    State.setViewMode(State.getState().viewMode === 'playlist' ? 'queue' : 'playlist');
    State.setSelectedSongPaths([]); // Clear selection when switching views
    State.setLastClickedPath(null);
}

export function clearQueue() {
    State.setPlayQueue([]);
    // The toast is now in a different module, so we need to import it where needed.
    // Let's have the caller in main.js show the toast.
}

export function updateActiveListHeader() {
    const { viewMode, musicData, searchMode } = State.getState();
    const isGlobalSearch = searchMode === 'global';
    
    DOM.viewToggleBtn.classList.toggle('hidden', isGlobalSearch);
    DOM.clearQueueBtn.classList.toggle('hidden', isGlobalSearch || viewMode !== 'queue');

    if (isGlobalSearch) {
        DOM.activeListTitle.textContent = 'Global Search';
    } else if (viewMode === 'queue') {
        DOM.activeListTitle.textContent = 'Up Next';
        setIcon(DOM.viewToggleBtn, 'music');
        DOM.viewToggleBtn.title = 'View Playlist';
    } else {
        DOM.activeListTitle.textContent = `Songs in ${musicData.activePlaylist}`;
        setIcon(DOM.viewToggleBtn, 'list');
        DOM.viewToggleBtn.title = 'View Queue';
    }
}

export function updateSearchUI() {
    const { searchMode } = State.getState();
    const isGlobal = searchMode === 'global';
    
    setIcon(DOM.searchModeToggleBtn, isGlobal ? 'globe' : 'list');
    DOM.searchModeToggleBtn.title = isGlobal ? 'Switch to Filter Current List' : 'Switch to Global Search';
    DOM.searchInput.placeholder = isGlobal ? "Search all songs..." : "Filter current list...";
}


export function renderAll() {
    renderPlaylists();
    renderSongList();
    updateActiveListHeader();
    updateSearchUI();
}

export function renderPlaylists() {
    const { musicData } = State.getState();
    DOM.playlistList.innerHTML = '';

    musicData.playlistOrder.forEach(name => {
        const li = document.createElement('li');
        li.className = 'playlist-list-item';
        li.dataset.playlistName = name;
        li.title = name;
        li.draggable = (name !== 'Default');
        li.classList.toggle('active', name === musicData.activePlaylist);
        
        const iconEl = document.createElement('i');
        setIcon(iconEl, 'music');
        
        const spanEl = document.createElement('span');
        spanEl.textContent = name;
        
        li.append(iconEl, spanEl);
        DOM.playlistList.appendChild(li);
    });

    if (!pList.dropIndicator) {
        pList.dropIndicator = document.createElement('div');
        pList.dropIndicator.className = 'playlist-drop-indicator';
    }
    DOM.playlistList.appendChild(pList.dropIndicator);
}

export function showPlaylistDropIndicator(y, elementsCache = null) {
    pList.dropIndicator.classList.add('visible');
    const afterElement = getDragAfterElement(DOM.playlistList, y, '.playlist-list-item:not(.dragging)', elementsCache);
    const top = afterElement ? afterElement.offsetTop - 2 : DOM.playlistList.scrollHeight;
    pList.dropIndicator.style.transform = `translateY(${top}px)`;
}

export function hidePlaylistDropIndicator() {
    pList.dropIndicator?.classList.remove('visible');
}