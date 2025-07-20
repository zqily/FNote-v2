/**
 * @module ui/virtualList
 * Manages the virtualized rendering of the song list.
 */

import * as DOM from '../dom.js';
import * as State from '../state.js';
import * as Api from '../api.js';
import * as UI from './index.js';
import { debounce, setIcon } from '../utils.js';

export const vList = {
    ITEM_HEIGHT: 46,
    BUFFER_ITEMS: 5,
    container: DOM.songListEl,
    sizer: null,
    visibleNodes: [],
    dataSource: [],
    isInitialized: false,
    dropIndicator: null
};

let pathsCurrentlyFetching = new Set();
let pendingPathsToFetch = new Set();
let isRenderScheduled = false; // Flag for requestAnimationFrame

const processPendingFetches = debounce(async () => {
    if (pendingPathsToFetch.size === 0) return;

    // Create a copy to work with, and clear the accumulator for the next batch
    const pathsToFetch = new Set(pendingPathsToFetch);
    pendingPathsToFetch.clear();

    await fetchSongData(pathsToFetch);
}, 16);


/**
 * Fetches song data for paths that are not in the cache or currently being fetched.
 * This is now called by the debounced processor, not directly.
 * @param {Set<string>} pathsToRequest - A set of song paths to fetch.
 */
async function fetchSongData(pathsToRequest) {
    if (pathsToRequest.size === 0) return;

    // Determine which paths are new and not already in flight
    const newPaths = Array.from(pathsToRequest).filter(p => !pathsCurrentlyFetching.has(p));
    if (newPaths.length === 0) return;

    // Mark these as in-flight
    newPaths.forEach(p => pathsCurrentlyFetching.add(p));

    try {
        const songsMap = await Api.getSongsByPaths(newPaths);
        State.addSongsToCache(songsMap);
        // After caching, re-render the list to show the new data.
        renderVisibleSongs();
    } catch (e) {
        console.error("Failed to fetch song data:", e);
        // On error, we could retry, but for now just log it. The `finally` block
        // will ensure paths can be re-requested on the next scroll.
    } finally {
        // Once complete, remove from the in-flight set so they can be requested again if needed.
        newPaths.forEach(p => pathsCurrentlyFetching.delete(p));
    }
}

export function getVisibleSongDataSource() {
    return vList.dataSource;
}

export function initVirtualList() {
    if (vList.isInitialized) return;
    vList.container.innerHTML = '';
    vList.container.setAttribute('tabindex', '0'); // Make focusable for keyboard nav
    vList.sizer = document.createElement('div');
    vList.sizer.id = 'song-list-sizer';
    vList.dropIndicator = document.createElement('div');
    vList.dropIndicator.className = 'drop-indicator hidden';
    vList.container.append(vList.sizer, vList.dropIndicator);
    
    // De-bounce scroll events with requestAnimationFrame for smoother rendering
    vList.container.addEventListener('scroll', () => {
        if (!isRenderScheduled) {
            isRenderScheduled = true;
            requestAnimationFrame(renderVisibleSongs);
        }
    }, { passive: true });
    
    vList.isInitialized = true;
}

export async function renderSongList() {
    if (!vList.isInitialized) initVirtualList();
    
    const { viewMode, searchMode, musicData, playQueue } = State.getState();
    const rawQuery = DOM.searchInput.value;
    
    const isLibraryTotallyEmpty = musicData.playlistOrder.length <= 1 && (musicData.playlists['Default'] || []).length === 0;
    let originalList;
    let suggestions = [];
    
    if (searchMode === 'global') {
        const result = rawQuery.trim() ? await Api.searchAllSongs(rawQuery) : { songs: [], suggestions: [] };
        vList.dataSource = result.songs;
        suggestions = result.suggestions;
        originalList = vList.dataSource; // For empty state check
    } else { // 'filter' mode
        if (viewMode === 'queue') {
            originalList = playQueue;
            if (!rawQuery.trim()) {
                vList.dataSource = originalList;
            } else {
                const query = rawQuery.trim().toLowerCase();
                // Queue is always fully loaded in memory, so local filtering is fine and instant.
                vList.dataSource = originalList.filter(song => 
                    song.name?.toLowerCase().includes(query) || song.artist?.toLowerCase().includes(query)
                );
            }
        } else { // viewMode is 'playlist'
            originalList = State.getActivePlaylist();
            if (!rawQuery.trim()) {
                vList.dataSource = originalList;
            } else {
                // Use the new API to search within the active playlist, which supports FTS5.
                const result = await Api.searchInPlaylist(musicData.activePlaylist, rawQuery);
                vList.dataSource = result.songs;
                suggestions = result.suggestions;
            }
        }
    }

    // After getting results, render autocomplete if there are suggestions.
    // This logic must not interfere with the local tag completion.
    const tagMatch = rawQuery.match(/(?:t:|tag:)([\w-]*)$/i);
    if (!tagMatch) {
        if (suggestions && suggestions.length > 0) {
            UI.renderAutocomplete(suggestions);
        } else {
            UI.hideAutocomplete();
        }
    }


    // --- Enhanced Empty State Logic ---
    const isSearching = rawQuery.trim().length > 0;
    const hasResults = vList.dataSource.length > 0;

    const showPlaylistEmptyState = (viewMode === 'playlist' || searchMode === 'global') && !isSearching && isLibraryTotallyEmpty;
    const showQueueEmptyState = viewMode === 'queue' && originalList.length === 0 && !isSearching;
    const showNoResultsState = isSearching && !hasResults;
    const showGlobalSearchPrompt = searchMode === 'global' && !isSearching && !isLibraryTotallyEmpty;

    const showList = !showPlaylistEmptyState && !showQueueEmptyState && !showNoResultsState && !showGlobalSearchPrompt;

    DOM.songListEl.classList.toggle('hidden', !showList);
    DOM.playlistEmptyState.classList.toggle('hidden', !showPlaylistEmptyState && !showNoResultsState && !showGlobalSearchPrompt);
    DOM.queueEmptyState.classList.toggle('hidden', !showQueueEmptyState);
    
    if (showPlaylistEmptyState) {
        setEmptyState(DOM.playlistEmptyState, 'slash', 'Library is Empty', 'Click "Import Songs" to begin.');
    } else if (showNoResultsState) {
        setEmptyState(DOM.playlistEmptyState, 'search', 'No Results Found', `No songs matched your search for "${rawQuery}".`);
    } else if (showGlobalSearchPrompt) {
        setEmptyState(DOM.playlistEmptyState, 'globe', 'Global Search', 'Search your entire library by title, artist, or tags.');
    }
    
    vList.sizer.style.height = `${vList.dataSource.length * vList.ITEM_HEIGHT}px`;
    renderVisibleSongs();
}

function setEmptyState(element, icon, title, text) {
    element.querySelector('h3').textContent = title;
    element.querySelector('p').textContent = text;
    const iconEl = element.querySelector('i');
    setIcon(iconEl, icon, { width: '2.5em', height: '2.5em' });
}


function renderVisibleSongs() {
    // Reset the scheduling flag so the next scroll event can trigger a render.
    isRenderScheduled = false;

    const startIndex = Math.floor(vList.container.scrollTop / vList.ITEM_HEIGHT);
    const numVisibleItems = Math.ceil(vList.container.clientHeight / vList.ITEM_HEIGHT);
    const renderStartIndex = Math.max(0, startIndex - vList.BUFFER_ITEMS);
    const renderEndIndex = Math.min(vList.dataSource.length - 1, startIndex + numVisibleItems + vList.BUFFER_ITEMS);

    const { currentSongIndex, selectedSongPaths } = State.getState();
    const playingSongPath = State.getActivePlaylist().find((s, i) => i === currentSongIndex)?.path;

    const songCache = State.getState().musicData.songs;

    while (vList.visibleNodes.length <= renderEndIndex - renderStartIndex) {
        const li = document.createElement('li');
        li.draggable = true;
        li.innerHTML = `<span class="song-item-title"></span><span class="song-item-artist"></span>`;
        vList.container.appendChild(li);
        vList.visibleNodes.push(li);
    }
    
    let nodeIndex = 0;
    for (let i = renderStartIndex; i <= renderEndIndex; i++, nodeIndex++) {
        const songData = vList.dataSource[i];
        const node = vList.visibleNodes[nodeIndex];
        
        // Position is always updated
        node.style.transform = `translateY(${i * vList.ITEM_HEIGHT}px)`;
        node.dataset.path = songData.path;
        
        const song = songCache[songData.path];

        // Determine new states for the node
        const isLoading = !song;
        const isPlaying = !isLoading && song.path === playingSongPath;
        const isSelected = !isLoading && selectedSongPaths.includes(song.path);
        const isMissing = !isLoading && song.isMissing;

        // Compare with cached state on the node and update classList/dataset only if changed.
        if (node.dataset.loading !== String(isLoading)) {
            node.classList.toggle('is-loading', isLoading);
            node.draggable = !isLoading;
            if (isLoading) {
                // Clear text content when switching to loading skeleton
                node.querySelector('.song-item-title').textContent = '';
                node.querySelector('.song-item-artist').textContent = '';
                // Invalidate text cache
                delete node.dataset.title;
                delete node.dataset.artist;
            }
            node.dataset.loading = String(isLoading);
        }

        if (isLoading) {
            pendingPathsToFetch.add(songData.path);
        } else {
            // Update text content only if it has changed
            const newTitle = song.name || 'Untitled';
            const newArtist = song.artist || 'Unknown Artist';
            if (node.dataset.title !== newTitle) {
                node.querySelector('.song-item-title').textContent = newTitle;
                node.dataset.title = newTitle;
            }
            if (node.dataset.artist !== newArtist) {
                node.querySelector('.song-item-artist').textContent = newArtist;
                node.dataset.artist = newArtist;
            }
            
            // Update other states
            if (node.dataset.playing !== String(isPlaying)) {
                node.classList.toggle('playing', isPlaying);
                node.dataset.playing = String(isPlaying);
            }
            if (node.dataset.missing !== String(isMissing)) {
                node.classList.toggle('missing', isMissing);
                node.dataset.missing = String(isMissing);
            }
            if (node.dataset.selected !== String(isSelected)) {
                node.classList.toggle('selected', isSelected);
                node.dataset.selected = String(isSelected);
            }
        }
        node.classList.remove('hidden');
    }

    for (let i = nodeIndex; i < vList.visibleNodes.length; i++) {
        vList.visibleNodes[i].classList.add('hidden');
    }

    processPendingFetches();
}

export function updateSongListUI() {
    renderVisibleSongs();
}

export function showDropIndicator(y) {
    vList.dropIndicator.classList.remove('hidden');
    const relativeY = y - vList.container.getBoundingClientRect().top + vList.container.scrollTop;
    const targetIndex = Math.round(relativeY / vList.ITEM_HEIGHT);
    const top = Math.min(targetIndex * vList.ITEM_HEIGHT - 1, vList.dataSource.length * vList.ITEM_HEIGHT - 2);
    vList.dropIndicator.style.transform = `translateY(${top}px)`;
}

export function hideDropIndicator() {
    vList.dropIndicator.classList.add('hidden');
}