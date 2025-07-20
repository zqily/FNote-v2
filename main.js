/**
 * @module Main
 * The main entry point for the application's frontend.
 * Initializes all modules, sets up state subscriptions, and handles global events.
 */

import * as Api from './api.js';
import * as State from './state.js';
import * as DOM from './dom.js';
import * as UI from './ui/index.js';
import * as Player from './player.js';
import * as Playlist from './playlist.js';
import * as Modals from './modals/index.js';
import { Progress } from './modals/progress.js';
import { updateSliderFill, debounce, formatTime, cacheIcons } from './utils.js';

// --- Render Scheduler ---
let isRenderScheduled = false;
const dirty = {
    songList: false,       // Full re-render (data source change)
    songListStyles: false, // Just selection/playback style updates
    playlists: false,
    player: false,
    header: false,
    shuffleRepeat: false,
    marker: false
};

/**
 * Schedules a UI update for the next animation frame.
 * Merges new update flags with existing ones.
 * @param {object} updates - An object with keys matching the 'dirty' object to mark parts of the UI for update.
 */
function scheduleRender(updates) {
    Object.assign(dirty, updates);
    if (!isRenderScheduled) {
        isRenderScheduled = true;
        requestAnimationFrame(performScheduledRenders);
    }
}

/**
 * Executes all scheduled UI updates. Called once per frame when updates are pending.
 */
async function performScheduledRenders() {
    // If a full song list render is needed, it also handles style updates, so we can skip the style-only check.
    if (dirty.songList) {
        await UI.renderSongList();
    } else if (dirty.songListStyles) {
        UI.updateSongListUI();
    }

    if (dirty.playlists) {
        UI.renderPlaylists();
    }
    
    if (dirty.header) {
        UI.updateActiveListHeader();
        UI.updateSearchUI();
    }

    if (dirty.player) {
        const song = State.getActivePlaylist()[State.getState().currentSongIndex];
        if (song) {
            await UI.updatePlayerInfo(song);
        } else {
            UI.resetPlayerUI();
        }
        // Broadcast the full new state when the song changes
        Api.broadcastStateChange({ key: 'fullState', value: window.getCurrentStateForSync() });
    }

    if (dirty.shuffleRepeat) {
        UI.updateShuffleButtonUI();
        UI.updateRepeatButtonUI();
    }

    if (dirty.marker) {
        UI.updateMarkerSelectionUI();
    }

    // Reset all flags and the schedule state for the next frame
    isRenderScheduled = false;
    for (const key in dirty) {
        dirty[key] = false;
    }
}


/**
 * Sets up subscriptions to the central state management.
 * This determines how different parts of the UI react to data changes.
 */
function initSubscriptions() {
    const broadcastState = (key, value) => {
        Api.broadcastStateChange({ key, value }).catch(e => {
            // This might fail if the other window is closed, which is fine.
            console.warn(`Could not broadcast state change for '${key}': ${e.message}`);
        });
    };

    // --- State to Render Scheduling ---
    State.subscribe('isShuffling', (isShuffling) => {
        scheduleRender({ shuffleRepeat: true });
        broadcastState('isShuffling', isShuffling);
    });
    State.subscribe('loopMode', (loopMode) => {
        scheduleRender({ shuffleRepeat: true });
        broadcastState('loopMode', loopMode);
    });

    State.subscribe('selectedMarker', () => scheduleRender({ marker: true }));
    State.subscribe('isExternalAudioActive', Player.handleExternalAudioChange);
    State.subscribe('discordRichPresenceEnabled', Player.updateDiscordPresence);
    State.subscribe('autoPauseAudioProcBlacklist', (blacklist) => {
        Api.saveAudioProcBlacklist(blacklist).catch(err => UI.showToast(`Failed to save blacklist: ${err.message}`, 'error'));
    });

    // More complex updates involving list re-renders
    State.subscribe('musicData', () => scheduleRender({ songList: true, playlists: true, header: true }));
    State.subscribe('playlists', () => scheduleRender({ songList: true }));
    State.subscribe('activePlaylist', () => scheduleRender({ playlists: true, songList: true, header: true }));
    State.subscribe('playlistOrder', () => scheduleRender({ playlists: true }));
    
    State.subscribe('playQueue', () => {
        if (State.getState().viewMode === 'queue') {
            scheduleRender({ songList: true });
        }
    });
    
    State.subscribe('viewMode', () => scheduleRender({ songList: true, header: true }));
    State.subscribe('searchMode', () => scheduleRender({ songList: true, header: true }));

    // Style-only updates for the song list
    State.subscribe('selectedSongPaths', () => scheduleRender({ songListStyles: true }));
    State.subscribe('currentSongIndex', () => {
        scheduleRender({ songListStyles: true, player: true });
    });

    // Handle song data updates from editing, color generation, etc.
    State.subscribe('songUpdated', (updatedSongData) => {
        // A style update is sufficient as the virtual list will re-read data from the updated cache.
        scheduleRender({ songListStyles: true }); 
        
        const { currentSongIndex } = State.getState();
        const currentSong = State.getActivePlaylist()[currentSongIndex];
        if (currentSong?.path === updatedSongData.path) {
            scheduleRender({ player: true });
        }
        // Broadly update other windows in case they are displaying this song
        broadcastState('fullState', window.getCurrentStateForSync());
    });
}

function initThrottledBroadcasters() {
    const audioPlayer = Player.getAudioPlayer();
    audioPlayer.addEventListener('timeupdate', debounce(() => {
        Api.broadcastStateChange({ key: 'timeUpdate', value: { currentTime: audioPlayer.currentTime, duration: audioPlayer.duration }});
    }, 250));
    audioPlayer.addEventListener('play', debounce(() => {
        Api.broadcastStateChange({ key: 'fullState', value: window.getCurrentStateForSync() });
    }, 100));
    audioPlayer.addEventListener('pause', debounce(() => {
        Api.broadcastStateChange({ key: 'fullState', value: window.getCurrentStateForSync() });
    }, 100));
}

/**
 * Initializes global event listeners for keyboard shortcuts, context menus, and search.
 */
function initGlobalListeners() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('click', (e) => {
        // Hide pop-ups when clicking away from them
        if (!DOM.searchInput.contains(e.target) && !DOM.autocompleteResults.contains(e.target)) {
            UI.hideAutocomplete();
        }
        if (!DOM.addPlaylistPopover.contains(e.target) && !DOM.addPlaylistBtn.contains(e.target)) {
            DOM.addPlaylistPopover.classList.add('hidden');
        }
        if (!DOM.exportPlaylistPopover.contains(e.target) && !DOM.playlistExportBtn.contains(e.target)) {
            DOM.exportPlaylistPopover.classList.add('hidden');
        }
        if (!DOM.tagBuilderPopover.contains(e.target) && !DOM.tagBuilderBtn.contains(e.target)) {
            UI.hideTagBuilder();
        }
        UI.hideSongContextMenu();
        UI.hidePlaylistContextMenu();
        State.setSelectedMarker(null);
    });

    // Search functionality
    DOM.searchModeToggleBtn.addEventListener('click', () => {
        const { searchMode } = State.getState();
        State.setSearchMode(searchMode === 'filter' ? 'global' : 'filter');
    });
    DOM.tagBuilderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.tagBuilderPopover.classList.contains('hidden')) {
            UI.showTagBuilder();
        } else {
            UI.hideTagBuilder();
        }
    });
    DOM.searchInput.addEventListener('input', UI.handleAutocomplete);
    DOM.searchInput.addEventListener('keydown', UI.handleAutocompleteNavigation);
    DOM.searchClearBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        DOM.searchInput.focus();
        UI.handleAutocomplete();
    });
    DOM.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (DOM.autocompleteResults.classList.contains('hidden')) {
                DOM.searchClearBtn.click();
            } else {
                UI.hideAutocomplete();
            }
        }
    });
    DOM.searchInput.addEventListener('focus', () => {
        DOM.searchInputContainer.classList.add('is-focused');
    });
    DOM.searchInput.addEventListener('blur', () => {
        DOM.searchInputContainer.classList.remove('is-focused');
    });

    // View mode toggling
    DOM.viewToggleBtn.addEventListener('click', UI.toggleViewMode);
    DOM.clearQueueBtn.addEventListener('click', () => {
        UI.clearQueue();
        UI.showToast('Queue cleared', 'info');
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', async (e) => {
        const isTyping = document.activeElement.matches('input:not([type="range"]), textarea');
        const isModalVisible = !!document.querySelector('.modal-overlay.visible');
        const isAutocompleteActive = !DOM.autocompleteResults.classList.contains('hidden');

        // --- Shortcuts that should work even in modals or while typing ---
        if (e.key === 'Escape') {
            // Let modal-specific listeners handle their own escape logic
            if (!isModalVisible) {
                if (isAutocompleteActive) UI.hideAutocomplete();
                else if (DOM.searchInput.value) DOM.searchClearBtn.click();
            }
            return;
        }

        // --- Global Control+Key shortcuts ---
        if (e.ctrlKey || e.metaKey) {
            // Prevent browser-level shortcuts
            if (['F', 'N', 'I', 'Q', 'PAGEDOWN', 'PAGEUP'].includes(e.key.toUpperCase())) e.preventDefault();
            
            if (e.key.toUpperCase() === 'F') DOM.searchInput.focus();
            
            if (!isModalVisible) {
                switch(e.key.toUpperCase()) {
                    case 'N': Playlist.createNewPlaylist(); break;
                    case 'I': DOM.importBtn.click(); break;
                    case 'Q': UI.toggleViewMode(); break;
                    case 'PAGEDOWN': Playlist.cyclePlaylist('next'); break;
                    case 'PAGEUP': Playlist.cyclePlaylist('prev'); break;
                }
            }
        }
        
        // --- Context-sensitive shortcuts (ignore if typing) ---
        if (isTyping) return;
        
        // --- Song List shortcuts ---
        const { selectedSongPaths } = State.getState();
        if (document.activeElement.closest('#song-list')) {
            switch(e.key.toUpperCase()) {
                case 'ENTER':
                    e.preventDefault();
                    if (selectedSongPaths.length > 0) {
                        if (e.ctrlKey || e.metaKey) Playlist.playSelectedNext();
                        else document.querySelector('#song-list li.selected')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                    }
                    break;
                case 'F2':
                    e.preventDefault();
                    if (selectedSongPaths.length > 0) DOM.editDetailsBtn.click();
                    break;
                case 'A':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) { // Ctrl+Shift+A -> Add to Queue
                            if (selectedSongPaths.length > 0) Playlist.addSelectedToQueue();
                        } else { // Ctrl+A -> Select All
                            const allPaths = UI.getVisibleSongDataSource().map(s => s.path);
                            State.setSelectedSongPaths(allPaths);
                            State.setLastClickedPath(allPaths.length > 0 ? allPaths[allPaths.length - 1] : null);
                        }
                    }
                    break;
                case 'ARROWUP':
                    e.preventDefault(); // Prevent page scroll
                    if (e.ctrlKey || e.metaKey) Playlist.reorderSelectedSongsInList('up');
                    else Playlist.navigateSongList('up');
                    break;
                case 'ARROWDOWN':
                    e.preventDefault(); // Prevent page scroll
                    if (e.ctrlKey || e.metaKey) Playlist.reorderSelectedSongsInList('down');
                    else Playlist.navigateSongList('down');
                    break;
            }
        }

        // --- Global Player shortcuts ---
        // Prevent default browser actions for player keys, unless an input is focused.
        if ([' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '[', ']'].includes(e.key)) {
            // The isTyping check already handles inputs, so this is mainly for browser scroll on space/arrows.
            e.preventDefault();
        }

        switch (e.key) {
            case ' ':
            case 'Spacebar':
                DOM.playPauseBtn.click();
                break;
            case 's':
            case 'S':
                DOM.shuffleBtn.click();
                break;
            case 'r':
            case 'R':
                DOM.repeatBtn.click();
                break;
            case 'm':
            case 'M':
                if (e.shiftKey) DOM.addMarkerBtn.click(); // Shift+M for adding markers
                else Player.toggleMute(); // M for mute/unmute
                break;
            case 'Delete':
                const { selectedMarker, viewMode } = State.getState();
                if (selectedMarker) await Player.deleteSelectedMarker();
                else if (selectedSongPaths.length > 0) {
                     if (viewMode === 'queue') Playlist.removeSelectedFromQueue();
                     else await Playlist.deleteSelectedSongs();
                }
                break;
            // Only trigger global volume/seek if not focused on song list
            case 'ArrowUp':
                if (!document.activeElement.closest('#song-list')) Player.changeVolume(5);
                break;
            case 'ArrowDown':
                if (!document.activeElement.closest('#song-list')) Player.changeVolume(-5);
                break;
            case 'ArrowRight': Player.seek(e.shiftKey ? 30 : 5); break;
            case 'ArrowLeft': Player.seek(e.shiftKey ? -30 : -5); break;
            case '[': Player.jumpToMarker('prev'); break;
            case ']': Player.jumpToMarker('next'); break;
        }
    });
}


/**
 * Initializes the sidebar resize handle functionality.
 */
function initResizeListener() {
    const handle = DOM.resizeHandle;
    if (!handle) return;
    const MIN_WIDTH = 250;
    const MAX_WIDTH = 500;

    const doResize = (e) => {
        let newWidth = Math.max(MIN_WIDTH, Math.min(e.clientX, MAX_WIDTH));
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    };

    const stopResize = () => {
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.classList.remove('resizing');

        const finalWidth = parseInt(document.documentElement.style.getPropertyValue('--sidebar-width'));
        if (!isNaN(finalWidth)) {
            Api.saveSidebarWidth(finalWidth)
                .catch(e => {
                    console.error("Could not save sidebar width:", e);
                    UI.showToast(`Failed to save sidebar width: ${e.message}`, 'error');
                });
        }
    };
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.classList.add('resizing');
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    });
}

/**
 * Initializes the vertical resize handle between playlist and song lists.
 */
function initVerticalResizeListener() {
    const handle = DOM.verticalResizeHandle;
    if (!handle) return;
    const playlistContainer = handle.closest('.playlist-container');
    const playlistsSection = handle.previousElementSibling; // This is the .playlists-section
    if (!playlistsSection) {
        console.error("Could not find the playlists section to resize.");
        return;
    }

    const MIN_HEIGHT = 80; // Minimum height for the playlist section
    let clickOffset = 0;

    const doResize = (e) => {
        const containerRect = playlistContainer.getBoundingClientRect();
        // The bottom boundary should leave enough space for the song list section.
        const MAX_HEIGHT = containerRect.height - 150; 
        
        const playlistsSectionRect = playlistsSection.getBoundingClientRect();
        // Calculate the new height based on the mouse position relative to the top of the resizing element,
        // adjusted by the initial click offset within the handle.
        let newHeight = e.clientY - playlistsSectionRect.top - clickOffset;
        
        newHeight = Math.max(MIN_HEIGHT, Math.min(newHeight, MAX_HEIGHT));
        document.documentElement.style.setProperty('--playlist-section-height', `${newHeight}px`);
    };

    const stopResize = () => {
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.classList.remove('resizing-vertical');

        const finalHeight = parseInt(document.documentElement.style.getPropertyValue('--playlist-section-height'));
        if (!isNaN(finalHeight)) {
            Api.savePlaylistSectionHeight(finalHeight)
                .catch(e => {
                    console.error("Could not save playlist section height:", e);
                    UI.showToast(`Failed to save layout: ${e.message}`, 'error');
                });
        }
    };

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        
        // Calculate where the user clicked inside the handle.
        const handleRect = handle.getBoundingClientRect();
        clickOffset = e.clientY - handleRect.top;

        document.body.classList.add('resizing-vertical');
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    });
}


/**
 * Initializes the event listeners for context menu actions.
 */
function initContextMenuListeners() {
    DOM.editDetailsBtn.addEventListener('click', (e) => {
        if (e.currentTarget.classList.contains('disabled')) return;
        const { selectedSongPaths } = State.getState();
        if (selectedSongPaths.length === 0) return;
        UI.hideSongContextMenu();

        const songs = State.getActivePlaylist().filter(s => selectedSongPaths.includes(s.path));
        if (songs.length > 0) Modals.openEditDetailsModal(songs);
    });

    DOM.playNextBtn.addEventListener('click', () => {
        if (State.getState().selectedSongPaths.length > 0) Playlist.playSelectedNext();
        UI.hideSongContextMenu();
    });

    DOM.addToQueueBtn.addEventListener('click', () => {
        if (State.getState().selectedSongPaths.length > 0) Playlist.addSelectedToQueue();
        UI.hideSongContextMenu();
    });

    DOM.showInExplorerBtn.addEventListener('click', async () => {
        if (DOM.showInExplorerBtn.classList.contains('disabled')) return;
        const { selectedSongPaths } = State.getState();
        if (selectedSongPaths.length !== 1) return;
        UI.hideSongContextMenu();

        try {
            // Api.showInExplorer uses callApi, which throws on explicit error status.
            await Api.showInExplorer(selectedSongPaths[0]);
            // No success toast needed, action is visual.
        } catch (e) {
            console.error("Failed to show file in explorer:", e);
            UI.showToast(`Could not show file: ${e.message}`, 'error');
        }
    });
    DOM.deleteBtn.addEventListener('click', () => {
        if (State.getState().selectedSongPaths.length === 0) return;

        if (State.getState().viewMode === 'queue') {
            Playlist.removeSelectedFromQueue(); // Local state change
        } else {
            Playlist.deleteSelectedSongs(); // Async, has try/catch and rollback
        }
        UI.hideSongContextMenu();
    });
}

/**
 * The core application startup sequence. Fetches data, sets up state, and initializes the UI.
 * Can be called again on retry.
 */
async function startApp() {
    try {
        UI.updateSplashStatus('Loading configuration...', true);
        const [config, initialData] = await Promise.all([
            Api.getInitialConfig(),
            Api.getInitialData()
        ]);
        
        UI.updateSplashStatus('Applying settings...', true);

        // --- Configure UI based on system/config ---
        if (config.system_status) {
            // Set context menu text based on OS
            const platform = config.system_status.platform;
            const span = DOM.showInExplorerBtn.querySelector('span');
            if (span) {
                if (platform === 'darwin') span.textContent = 'Show in Finder';
                else if (platform !== 'win32') span.textContent = 'Show in File Manager';
            }
            // Show FFmpeg warning if not found
            if (!config.system_status.has_ffmpeg) {
                DOM.ffmpegWarning.classList.remove('hidden');
                DOM.ffmpegWarning.querySelector('a')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    Api.openExternalLink(e.target.href);
                });
            }
        }

        // --- Load Data and Set Initial State ---
        if (initialData) {
            if (initialData.musicData?.playlists && initialData.musicData.playlistOrder) {
                State.setMusicData(initialData.musicData);
            }
            if (initialData.tagData) { 
                State.setTagData(initialData.tagData);
            }
        }
        
        // --- Apply Saved Settings ---
        State.setLoopMode(config.loopMode || 'none');
        State.setShuffling(config.isShuffling || false);
        State.setToastDuration(config.toastDuration !== undefined ? config.toastDuration : 3);
        State.setRunOnStartup(config.runOnStartup || false);
        State.setResumeOnStartup(config.resumeOnStartup || false);
        State.setIsStartupLaunch(config.isStartupLaunch || false);
        State.setAutoPauseEnabled(config.autoPauseOnExternalAudio || false);
        State.setAutoPauseAudioProcBlacklist(config.autoPauseAudioProcBlacklist || []);
        State.setDiscordPresenceEnabled(config.discordRichPresence || false);

        // --- Apply Saved UI State ---
        document.documentElement.style.setProperty('--sidebar-width', `${config.sidebarWidth || 300}px`);
        document.documentElement.style.setProperty('--playlist-section-height', `${config.playlistSectionHeight || 150}px`);
        Player.getAudioPlayer().volume = (config.volume || 100) / 100;
        Player.getAudioPlayer().loop = (State.getState().loopMode === 'song');
        DOM.volumeSlider.value = config.volume || 100;
        DOM.toastDurationInput.value = State.getState().toastDuration;
        DOM.runOnStartupToggle.checked = State.getState().runOnStartup;
        DOM.resumeOnStartupToggle.checked = State.getState().resumeOnStartup;
        DOM.resumeOnStartupSetting.classList.toggle('hidden', !DOM.runOnStartupToggle.checked);
        DOM.autoPauseToggle.checked = State.getState().autoPauseEnabled;
        DOM.discordPresenceToggle.checked = State.getState().discordRichPresenceEnabled;
        updateSliderFill(DOM.volumeSlider);
        UI.updateVolumeIcon(config.volume || 100);

        // --- Restore Last Playback State ---
        if (config.lastPlayedSongPath && config.lastPlayedPlaylist) {
            const playlistPaths = State.getState().musicData.playlists[config.lastPlayedPlaylist];
            if (playlistPaths) {
                const songIndex = playlistPaths.findIndex(p => p === config.lastPlayedSongPath);
        
                if (songIndex > -1) {
                    // The song cache is empty on startup, so we must fetch its data first.
                    const songDataMap = await Api.getSongsByPaths([config.lastPlayedSongPath]);
                    const songToLoad = songDataMap ? songDataMap[config.lastPlayedSongPath] : null;

                    if (songToLoad) {
                        State.addSongsToCache(songDataMap);
                        State.setActivePlaylist(config.lastPlayedPlaylist);

                        // Add the event listener to handle seeking and eventual playback.
                        const audioPlayer = Player.getAudioPlayer();
                        audioPlayer.addEventListener('loadedmetadata', () => {
                            audioPlayer.currentTime = config.lastPlayedTime || 0;
                            const { resumeOnStartup, isStartupLaunch } = State.getState();
                            if (resumeOnStartup && isStartupLaunch) {
                                setTimeout(() => {
                                    Player.getAudioPlayer().play().catch(e => console.error("Auto-play failed:", e));
                                }, 100);
                            }
                        }, { once: true });
                        
                        // Use the canonical player function to load the song and set state, but not play it.
                        // The event listener above will handle the actual playback.
                        await Player.playSongByIndex(songIndex, { play: false });
                    }
                }
            }
        }

        // --- Finalize Initialization ---
        UI.updateSplashStatus('Starting application...', false);

        // Generate the shuffled playlist if shuffling was enabled on last close
        if (State.getState().isShuffling) {
            Playlist.generateShuffledPlaylist();
        }

        // Handle opening a file on startup
        const startupFile = await Api.getStartupFile();
        if (startupFile) {
            const toast = UI.showToast('Importing startup playlist...', 'info', 0);
            try {
                const response = await Api.importPlaylist(startupFile);
                if (response?.playlist) {
                    Playlist.addPlaylistToState(response.playlist);
                    UI.showToast(`Playlist "${response.playlist.name}" imported.`, 'success');
                }
            } catch (e) {
                console.error("Failed to process startup file:", e);
                UI.showToast(`Error importing startup file: ${e.message}`, 'error');
            } finally {
                toast.remove();
            }
        }
        
        // Everything loaded, hide the splash screen and show the app.
        UI.hideSplashScreen();

    } catch (e) {
        console.error("Fatal: Could not load initial data/config from Python:", e);
        const errorMessage = e.message || "An unknown error occurred during startup.";
        UI.showSplashError(`Failed to load application. Please check your connection and try again.\n\nError: ${errorMessage}`);
        // Do not hide the splash screen, let the user retry.
    }
}

/**
 * Main application entry point, triggered when the pywebview backend is ready.
 */
window.addEventListener('pywebviewready', () => {
    // This is the global state object requested by the mini-player on init
    window.getCurrentStateForSync = () => {
        const { currentSongIndex } = State.getState();
        const song = State.getActivePlaylist()[currentSongIndex];
        const audio = Player.getAudioPlayer();
        return {
            song: song || null,
            isPlaying: !audio.paused,
            isShuffling: State.getState().isShuffling,
            loopMode: State.getState().loopMode,
            currentTime: audio.currentTime,
            duration: audio.duration,
            volume: audio.volume * 100,
            coverData: song ? State.getCoverFromCache(song.path) : null,
            accentColor: song?.accentColor,
            // Additions for override state
            isExternalAudioActive: State.getState().isExternalAudioActive,
            wasPlayingBeforeExternalAudio: State.getState().wasPlayingBeforeExternalAudio,
            externalAudioSources: State.getState().externalAudioSources
        };
    };

    // This handles state updates broadcasted from the backend (originating from another window)
    window.handleStateUpdate = (payload) => {
        const { key, value } = payload;
        switch (key) {
            case 'isShuffling': State.setShuffling(value); break;
            case 'loopMode': State.setLoopMode(value); break;
            case 'currentSongIndex': State.setCurrentSongIndex(value); break;
            case 'volume': 
                Player.setVolume(value, { broadcast: false }); // Update volume without re-broadcasting
                break;
            case 'timeUpdate':
                // Only update if the seek bar is not being dragged
                if (!Player.getIsSeeking() && value.duration) {
                    DOM.seekBar.value = value.currentTime / value.duration;
                    updateSliderFill(DOM.seekBar);
                    DOM.currentTimeEl.textContent = formatTime(value.currentTime);
                    DOM.totalDurationEl.textContent = formatTime(value.duration);
                }
                break;
            case 'fullState':
                // This is for broader sync if needed, but granular is often better.
                // Example: If a song changes, update the player UI.
                if (value.song) {
                    const currentSong = State.getActivePlaylist()[State.getState().currentSongIndex];
                    if (currentSong?.path !== value.song.path) {
                        // This case is handled by currentSongIndex change subscription
                    }
                }
                UI.setPlayPauseIcon(value.isPlaying ? 'pause' : 'play');
                break;
        }
    };
    
    // --- Expose functions to Python backend ---
    window.updateSongAccentColor = (path, color) => {
        State.updateSong({ path, accentColor: color });
    };

    window.completeAccentRefresh = (message, isError = false) => {
        Progress.close();
        UI.showGlobalStatus(message, { isActive: false, isError });
        if (DOM.refreshAccentsBtn) {
            DOM.refreshAccentsBtn.textContent = 'Refresh';
            DOM.refreshAccentsBtn.disabled = false;
        }
        // Update player if current song was part of the refresh
        const { currentSongIndex } = State.getState();
        if (currentSongIndex > -1) {
            const currentSong = State.getActivePlaylist()[currentSongIndex];
            if(currentSong) UI.updatePlayerInfo(currentSong);
        }
    };
    window.completeUrlDownload = async (response) => {
        // This is now just for adding the final songs to the state,
        // the progress UI is handled by progress_finish.
        if (response?.status === 'success' && response.songs?.length > 0) {
            await Playlist.addSongsToActivePlaylist(response.songs);
        }
    };
    window.setExternalAudioState = (payload) => {
        if (State.getState().autoPauseEnabled) {
            State.setExternalAudioSources(payload.sources || []);
            State.setIsExternalAudioActive(payload.isActive);
        }
    };

    window.handleCommand = (command, argsJson) => {
        const args = JSON.parse(argsJson);
        if (Player[command]) Player[command](...args);
    };

    // --- New Progress API for Python ---
    window.progress_start = (title, items) => {
        Progress.open(title, items);
        UI.showGlobalStatus(title, {
            isActive: true,
            summary: `0 / ${items.length}`,
            onDetailsClick: () => DOM.progressModal.classList.add('visible')
        });
    };

    window.progress_update = (id, status, text, current, total) => {
        Progress.update(id, status, text);
        UI.showGlobalStatus(DOM.progressModalTitle.textContent, {
            isActive: true,
            summary: `${current} / ${total}`,
            onDetailsClick: () => DOM.progressModal.classList.add('visible')
        });
    };

    window.progress_finish = (message, isError) => {
        Progress.close();
        UI.showGlobalStatus(message, { isActive: false, isError: isError });
    };

    
    // Initialize required components first
    feather.replace({ width: '1em', height: '1em' });
    cacheIcons();
    initSubscriptions(); 
    Player.initPlayerEventListeners();
    Playlist.initPlaylistEventListeners();
    Modals.initModalEventListeners();
    initGlobalListeners();
    initResizeListener();
    initVerticalResizeListener();
    initContextMenuListeners();
    initThrottledBroadcasters();
    
    // Add event listener for the retry button
    DOM.splashRetryBtn.addEventListener('click', startApp);

    // Kick off the main application loading sequence.
    // Do NOT await this. This allows the event listener to complete while startApp
    // runs asynchronously. The internal try/catch in startApp will handle errors
    // and update the splash screen UI correctly, which wouldn't happen if this
    // await call hung indefinitely.
    startApp();
});