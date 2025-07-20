/**
 * @module Player
 * Handles all audio playback, controls, and visualizer logic.
 */

import * as DOM from './dom.js';
import * as State from './state.js';
import * as UI from './ui/index.js';
import * as Playlist from './playlist.js';
import * as Api from './api.js';
import { updateSliderFill, formatTime } from './utils.js';

// The width of the seek bar thumb in pixels, from _components.css, used for positioning calculations.
const THUMB_WIDTH = 18;

const audioPlayer = new Audio();
let audioContext, analyser, sourceNode, frequencyData;
let isAudioApiInitialized = false;
let animationFrameId;
let isSeeking = false;
let lastVolumeBeforeMute = 100;

/**
 * Gets the singleton audio player instance.
 * @returns {HTMLAudioElement} The audio element.
 */
export function getAudioPlayer() {
    return audioPlayer;
}
export const getIsSeeking = () => isSeeking;


/**
 * Updates the Rich Presence status on Discord.
 */
export function updateDiscordPresence() {
    // Check if the feature is enabled in state first
    if (!State.getState().discordRichPresenceEnabled) {
        Api.updateRichPresence(null).catch(err => console.warn("Failed to clear DRP on disable:", err));
        return;
    }

    const { currentSongIndex } = State.getState();
    const song = State.getActivePlaylist()[currentSongIndex];
    const audio = getAudioPlayer();

    // Condition to clear presence: no song loaded or playback has ended and player is reset
    if (!song || !audio.src) {
        Api.updateRichPresence(null).catch(err => console.warn("Failed to clear DRP:", err));
        return;
    }

    const payload = {
        details: song.name.substring(0, 128),
        state: song.artist ? `by ${song.artist}`.substring(0, 128) : 'Unknown Artist',
        large_image: 'fnote', // Asset key from Discord dev portal
        large_text: 'FNote Music Player',
    };

    if (audio.paused) {
        // If paused, don't show the timer
        payload.small_image = 'pause';
        payload.small_text = 'Paused';
    } else {
        // If playing, calculate start time to show "elapsed" timer
        payload.small_image = 'play';
        payload.small_text = 'Playing';
        payload.start = Math.floor(Date.now() / 1000) - Math.floor(audio.currentTime);
    }
    
    Api.updateRichPresence(payload).catch(err => console.warn("Failed to update DRP:", err));
}

/**
 * Sets the player volume to a specific level.
 * @param {number} newVolume - The new volume level (0-100).
 * @param {object} [options={}] - Configuration options.
 * @param {boolean} [options.broadcast=true] - Whether to broadcast the state change to other windows.
 */
export function setVolume(newVolume, options = {}) {
    const { broadcast = true } = options;
    newVolume = Math.max(0, Math.min(100, Math.round(newVolume)));
    
    audioPlayer.volume = newVolume / 100;
    DOM.volumeSlider.value = newVolume;
    updateSliderFill(DOM.volumeSlider);
    UI.updateVolumeIcon(newVolume);
    
    if (newVolume > 0) {
        lastVolumeBeforeMute = newVolume;
    }
    
    if (broadcast) {
        Api.broadcastStateChange({ key: 'volume', value: newVolume });
    }
}

/**
 * Changes the player volume by a given amount.
 * @param {number} amount - The amount to change the volume by (e.g., 5 or -5).
 */
export function changeVolume(amount) {
    const currentVolume = audioPlayer.volume * 100;
    const newVolume = currentVolume + amount;
    setVolume(newVolume);
    Api.saveVolume(audioPlayer.volume * 100);
}

/**
 * Toggles the player's mute state.
 */
export function toggleMute() {
    const currentVolume = audioPlayer.volume * 100;
    if (currentVolume > 0) {
        lastVolumeBeforeMute = currentVolume;
        setVolume(0);
    } else {
        const restoreVolume = lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 100;
        setVolume(restoreVolume);
    }
    Api.saveVolume(audioPlayer.volume * 100);
}

/**
 * Seeks the current track forward or backward by a number of seconds.
 * @param {number} seconds - The number of seconds to seek (positive or negative).
 */
export function seek(seconds) {
    if (!audioPlayer.src || !audioPlayer.duration) return;
    const newTime = audioPlayer.currentTime + seconds;
    audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, newTime));
}

/** Jumps playback to a specific percentage of the song. */
export function seekToPercentage(percentage) {
    if (audioPlayer.duration) {
        audioPlayer.currentTime = audioPlayer.duration * percentage;
    }
}


/**
 * Jumps playback to the next or previous marker in the current song.
 * @param {'next'|'prev'} direction - The direction to jump.
 */
export function jumpToMarker(direction) {
    const currentSong = State.getActivePlaylist()[State.getState().currentSongIndex];
    if (!currentSong?.markers?.length || !audioPlayer.duration) return;

    const currentTime = audioPlayer.currentTime;
    let targetMarker;

    if (direction === 'next') {
        // Find the first marker with a timestamp slightly after the current time
        targetMarker = currentSong.markers.find(m => m.timestamp > currentTime + 0.1);
    } else { // 'prev'
        // Find the last marker with a timestamp before the current time (with a buffer)
        targetMarker = [...currentSong.markers].reverse().find(m => m.timestamp < currentTime - 0.5);
    }

    if (targetMarker) {
        audioPlayer.currentTime = targetMarker.timestamp;
    } else if (direction === 'prev') {
        // If no previous marker is found, jump to the start of the song
        audioPlayer.currentTime = 0;
    }
}

/**
 * Deletes a marker by its ID.
 * @param {string} markerId The ID of the marker to delete.
 */
export async function deleteMarker(markerId) {
    const { currentSongIndex } = State.getState();
    const currentSong = State.getActivePlaylist()[currentSongIndex];
    if (!markerId || !currentSong?.markers) return;

    const originalMarkers = JSON.parse(JSON.stringify(currentSong.markers));
    const wasSelected = State.getState().selectedMarker?.id === markerId;

    // Optimistic update
    currentSong.markers = currentSong.markers.filter(m => m.id !== markerId);
    if (wasSelected) State.setSelectedMarker(null);
    UI.renderMarkers(audioPlayer.duration);

    const markerTimestamps = currentSong.markers.map(m => m.timestamp);
    try {
        await Api.saveMarkers(currentSong.path, markerTimestamps);
        UI.showToast("Marker deleted.", "info");
    } catch (err) {
       UI.showToast(`Failed to save marker changes: ${err.message}`, 'error');
       currentSong.markers = originalMarkers; // Rollback
       if (wasSelected) {
           const originalMarker = originalMarkers.find(m => m.id === markerId);
           State.setSelectedMarker(originalMarker);
       }
       UI.renderMarkers(audioPlayer.duration);
    }
}

/**
 * Deletes the currently selected marker.
 */
export async function deleteSelectedMarker() {
    const { selectedMarker } = State.getState();
    if (selectedMarker) {
        await deleteMarker(selectedMarker.id);
    }
}

/**
 * Updates a marker's timestamp after a drag-and-drop operation.
 * @param {string} markerId The ID of the marker to update.
 * @param {number} newTimestamp The new timestamp for the marker.
 */
export async function updateMarkerTimestamp(markerId, newTimestamp) {
    const { currentSongIndex } = State.getState();
    const currentSong = State.getActivePlaylist()[currentSongIndex];
    if (!markerId || !currentSong?.markers) return;

    const originalMarkers = JSON.parse(JSON.stringify(currentSong.markers));
    const markerToUpdate = currentSong.markers.find(m => m.id === markerId);
    if (!markerToUpdate) return;

    // Optimistic update
    markerToUpdate.timestamp = newTimestamp;
    currentSong.markers.sort((a, b) => a.timestamp - b.timestamp);
    UI.renderMarkers(audioPlayer.duration); // Re-render to apply sorted order

    const markerTimestamps = currentSong.markers.map(m => m.timestamp);
    try {
        await Api.saveMarkers(currentSong.path, markerTimestamps);
    } catch (err) {
        UI.showToast(`Failed to save marker position: ${err.message}`, 'error');
        currentSong.markers = originalMarkers; // Rollback
        UI.renderMarkers(audioPlayer.duration);
    }
}

/**
 * Initializes the Web Audio API for the visualizer. Called lazily on first playback.
 */
export function initAudioApi() {
    if (isAudioApiInitialized) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512; 
        sourceNode = audioContext.createMediaElementSource(audioPlayer);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        isAudioApiInitialized = true;
    } catch (e) {
        console.error("Could not initialize Web Audio API:", e);
    }
}

/**
 * Plays a song from the active playlist by its index.
 * @param {number} index - The index of the song to play in the active playlist.
 * @param {object} [options={}] - Playback options.
 * @param {boolean} [options.clearQueue=false] - Whether to clear the queue before playing.
 * @param {boolean} [options.play=true] - Whether to start playback immediately.
 */
export async function playSongByIndex(index, options = {}) {
    const finalOptions = { clearQueue: false, play: true, ...options };
    if (finalOptions.clearQueue) {
        State.setPlayQueue([]);
    }

    const initialPlaylist = State.getActivePlaylist();
    const songToPlayRef = initialPlaylist[index];
    
    if (!songToPlayRef) {
        State.setCurrentSongIndex(-1);
        return;
    }

    // Check if the song data is just a placeholder and fetch it if needed.
    if (songToPlayRef.isPlaceholder) {
        try {
            const songDataMap = await Api.getSongsByPaths([songToPlayRef.path]);
            if (!songDataMap || !songDataMap[songToPlayRef.path]) {
                UI.showToast(`Could not load data for song. It may have been removed.`, 'error');
                playNextSong(true); // Treat as if song ended and play next.
                return;
            }
            State.addSongsToCache(songDataMap);
        } catch (e) {
            console.error("Failed to fetch song data for playback:", e);
            UI.showToast(`Error loading song: ${e.message}`, 'error');
            return;
        }
    }

    // Now, get the final, complete song object from the updated state.
    const currentPlaylist = State.getActivePlaylist();
    const songToPlay = currentPlaylist[index];

    if (!songToPlay) {
        State.setCurrentSongIndex(-1);
        return;
    }

    if (songToPlay.isMissing) {
        UI.showToast(`File for "${songToPlay.name}" is missing.`, 'error');
        playNextSong(true); // Automatically skip to the next song
        return;
    }

    // If the same song is clicked again, toggle play/pause or restart it.
    if (index === State.getState().currentSongIndex && audioPlayer.src) {
        if (audioPlayer.paused) audioPlayer.play();
        else audioPlayer.currentTime = 0;
        return;
    }

    if (!isAudioApiInitialized) initAudioApi();
    
    State.setSelectedSongPaths([songToPlay.path]);
    State.setLastClickedPath(songToPlay.path);
    State.setSelectedMarker(null);
    State.setCurrentSongIndex(index); // This is the main trigger for UI updates.

    if (State.getState().isShuffling) {
        const shuffledIndex = State.getState().shuffledPlaylist.findIndex(s => s.path === songToPlay.path);
        State.setShuffledIndex(shuffledIndex);
    }

    try {
        const dataUri = await Api.getSongDataUri(songToPlay.path);
        if (!dataUri) {
            throw new Error("Backend returned no data for the song.");
        }
        audioPlayer.src = dataUri;
        audioPlayer.loop = (State.getState().loopMode === 'song');
        
        if (finalOptions.play) {
            audioPlayer.play().catch(e => console.error("Error playing audio:", e));
        }
    } catch (e) {
        console.error("Failed to load song data URI:", e);
        UI.showToast(`Could not play song: ${e.message}`, 'error');
        State.setCurrentSongIndex(-1); // Reset player state on failure
    }
}

/**
 * Plays the next song based on queue, shuffle, and repeat settings.
 * @param {boolean} [fromEnded=false] - True if called automatically from an 'onended' event.
 */
export function playNextSong(fromEnded = false) {
    const { playQueue, musicData } = State.getState();
    // 1. Check the "Play Next" queue first.
    if (playQueue.length > 0) {
        const nextSongInQueue = playQueue[0];
        State.setPlayQueue(playQueue.slice(1));

        let songIndex = State.getActivePlaylist().findIndex(s => s.path === nextSongInQueue.path);
        
        if (songIndex > -1) {
            playSongByIndex(songIndex, { clearQueue: false });
        } else {
            const homePlaylist = musicData.playlistOrder.find(pName => musicData.playlists[pName].some(s => s.path === nextSongInQueue.path));
            if (homePlaylist) {
                Playlist.switchPlaylist(homePlaylist).then(() => {
                    const newIndex = State.getActivePlaylist().findIndex(s => s.path === nextSongInQueue.path);
                    if (newIndex > -1) playSongByIndex(newIndex, { clearQueue: false });
                });
            } else {
                playNextSong(fromEnded); // Song not found anywhere, try next in queue.
            }
        }
        return;
    }

    // 2. Determine next song from the main playlist.
    const currentPlaylist = State.getActivePlaylist();
    if (currentPlaylist.length === 0) return;
    
    let nextIndex;
    const { isShuffling, loopMode, shuffledPlaylist, currentSongIndex } = State.getState();
    let { shuffledIndex } = State.getState();

    if (isShuffling) {
        shuffledIndex++;
        if (shuffledIndex >= shuffledPlaylist.length) {
            shuffledIndex = 0;
            if (loopMode !== 'playlist' && fromEnded) {
                State.setCurrentSongIndex(-1); // Stop playback
                return;
            }
        }
        State.setShuffledIndex(shuffledIndex);
        const nextSongPath = shuffledPlaylist[shuffledIndex].path;
        nextIndex = currentPlaylist.findIndex(song => song.path === nextSongPath);
    } else {
        nextIndex = currentSongIndex + 1;
        if (nextIndex >= currentPlaylist.length) {
            nextIndex = 0;
            if (loopMode !== 'playlist' && fromEnded) {
                State.setCurrentSongIndex(-1); // Stop playback
                return;
            }
        }
    }
    playSongByIndex(nextIndex);
}

/**
 * Plays the previous song based on shuffle settings.
 */
export function playPrevSong() {
    const currentPlaylist = State.getActivePlaylist();
    if (currentPlaylist.length === 0) return;

    let prevIndex;
    const { isShuffling, shuffledPlaylist, currentSongIndex } = State.getState();
    let { shuffledIndex } = State.getState();

    if (isShuffling) {
        shuffledIndex = (shuffledIndex - 1 + shuffledPlaylist.length) % shuffledPlaylist.length;
        State.setShuffledIndex(shuffledIndex);
        const prevSongPath = shuffledPlaylist[shuffledIndex].path;
        prevIndex = currentPlaylist.findIndex(song => song.path === prevSongPath);
    } else {
        prevIndex = (currentSongIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    }
    playSongByIndex(prevIndex);
}

/**
 * Handles changes in the external audio state.
 * @param {boolean} isActive - Whether external audio is now active.
 */
export function handleExternalAudioChange(isActive) {
    if (isActive) {
        // External audio has just started
        const wasPlaying = !audioPlayer.paused;
        State.setWasPlayingBeforeExternalAudio(wasPlaying);
        if (wasPlaying) {
            audioPlayer.pause();
        }
        DOM.playPauseBtn.classList.add('overridden');
    } else {
        // External audio has just stopped
        DOM.playPauseBtn.classList.remove('overridden');
        if (State.getState().wasPlayingBeforeExternalAudio) {
            audioPlayer.play().catch(e => console.error("Auto-resume failed:", e));
        } else if (audioPlayer.paused) {
            // If not resuming, the player is in a paused state. Manually update the icon
            // because the onpause event won't fire again.
            UI.setPlayPauseIcon('play');
        }
        State.setWasPlayingBeforeExternalAudio(false);
    }
    // Broadcast the full state to keep all windows in sync with the override status
    Api.broadcastStateChange({ key: 'fullState', value: window.getCurrentStateForSync() });
}

/**
 * Renders the visualizer animation frame.
 */
function renderVisualizer() {
    if (!analyser) return;
    analyser.getByteFrequencyData(frequencyData);
    // Average frequencies into 5 bands for the 5 bars
    const values = [
        frequencyData.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
        frequencyData.slice(5, 30).reduce((a, b) => a + b, 0) / 25,
        frequencyData.slice(30, 80).reduce((a, b) => a + b, 0) / 50,
        frequencyData.slice(80, 150).reduce((a, b) => a + b, 0) / 70,
        frequencyData.slice(150, 255).reduce((a, b) => a + b, 0) / 105
    ];
    DOM.eqBars.forEach((bar, i) => {
        const height = Math.min(100, Math.max(1, (values[i] / 255) * 150));
        bar.style.height = `${height}%`;
    });
    animationFrameId = requestAnimationFrame(renderVisualizer);
}

// --- Functions exposed for remote control (e.g., mini-player) ---
export function togglePlayPause() { DOM.playPauseBtn.click(); }
export function toggleShuffle() { DOM.shuffleBtn.click(); }
export function toggleRepeat() { DOM.repeatBtn.click(); }


/**
 * Initializes all event listeners for the player controls.
 */
export function initPlayerEventListeners() {
    DOM.playPauseBtn.addEventListener('click', () => {
        const { autoPauseEnabled, isExternalAudioActive } = State.getState();
        if (autoPauseEnabled && isExternalAudioActive) {
            // If overridden, the click only toggles the "desired" state for when the override ends.
            const willPlayAfter = !State.getState().wasPlayingBeforeExternalAudio;
            State.setWasPlayingBeforeExternalAudio(willPlayAfter);
            // Update the icon to reflect the desired state
            UI.setPlayPauseIcon(willPlayAfter ? 'pause' : 'play');
            // Broadcast the change so other windows update their UI
            Api.broadcastStateChange({ key: 'fullState', value: window.getCurrentStateForSync() });
            return; // Prevents the rest of the click handler from running
        }

        if (!isAudioApiInitialized) initAudioApi();
        if (State.getActivePlaylist().length === 0) return;

        if (audioPlayer.paused) {
            if (!audioPlayer.src) {
                // If nothing is loaded, play the first selected song or the first in the list
                const { selectedSongPaths } = State.getState();
                const playlist = State.getActivePlaylist();
                let indexToPlay = 0;
                if (selectedSongPaths.length > 0) {
                    const firstSelected = playlist.findIndex(song => selectedSongPaths.includes(song.path));
                    if (firstSelected > -1) indexToPlay = firstSelected;
                }
                playSongByIndex(indexToPlay, { clearQueue: true });
            } else {
                audioPlayer.play();
            }
        } else {
            audioPlayer.pause();
        }
    });

    DOM.nextBtn.addEventListener('click', () => playNextSong(false));
    DOM.prevBtn.addEventListener('click', playPrevSong);
    DOM.miniPlayerBtn.addEventListener('click', () => Api.toggleMiniPlayer(true));

    DOM.shuffleBtn.addEventListener('click', () => {
        const newShuffleState = !State.getState().isShuffling;
        State.setShuffling(newShuffleState);
        Api.saveShuffleMode(newShuffleState);
        if (newShuffleState) Playlist.generateShuffledPlaylist();
    });

    DOM.repeatBtn.addEventListener('click', () => {
        const modes = ['none', 'playlist', 'song'];
        const currentModeIndex = modes.indexOf(State.getState().loopMode);
        const newLoopMode = modes[(currentModeIndex + 1) % modes.length];
        
        State.setLoopMode(newLoopMode);
        Api.saveLoopMode(newLoopMode);
        audioPlayer.loop = (newLoopMode === 'song');
    });

    DOM.addMarkerBtn.addEventListener('click', () => {
        if (State.getState().currentSongIndex === -1 || !audioPlayer.duration) {
            UI.showToast('A song must be playing to add a marker.', 'error');
            return;
        }
        const currentSong = State.getActivePlaylist()[State.getState().currentSongIndex];
        currentSong.markers = currentSong.markers || [];
        
        const newTimestamp = audioPlayer.currentTime;
        
        // Error prevention: Don't add a new marker too close to an existing one
        if (currentSong.markers.some(m => Math.abs(m.timestamp - newTimestamp) < 0.5)) {
            UI.showToast("New marker is too close to an existing one.", "info");
            return;
        }

        currentSong.markers.push({ id: `marker_${Date.now()}`, timestamp: newTimestamp });
        currentSong.markers.sort((a, b) => a.timestamp - b.timestamp);
        UI.renderMarkers(audioPlayer.duration);
        Api.saveMarkers(currentSong.path, currentSong.markers.map(m => m.timestamp));
    });

    DOM.volumeToggleBtn.addEventListener('click', toggleMute);

    DOM.volumeSlider.addEventListener('input', (e) => {
        setVolume(parseInt(e.target.value, 10));
    });
    DOM.volumeSlider.addEventListener('change', (e) => Api.saveVolume(parseInt(e.target.value, 10)).catch(err => UI.showToast(`Failed to save volume: ${err.message}`, 'error')));

    DOM.seekBar.addEventListener('mousedown', () => { isSeeking = true; });
    DOM.seekBar.addEventListener('change', (e) => {
        if(audioPlayer.duration) audioPlayer.currentTime = e.target.value * audioPlayer.duration;
        isSeeking = false;
        updateSliderFill(e.target);
    });
    DOM.seekBar.addEventListener('input', (e) => {
        updateSliderFill(e.target);
        if (isSeeking && audioPlayer.duration) {
            DOM.currentTimeEl.textContent = formatTime(e.target.value * audioPlayer.duration);
        }
    });

    DOM.seekBarWrapper.addEventListener('dblclick', (e) => {
        const { currentSongIndex } = State.getState();
        if (currentSongIndex === -1 || !audioPlayer.duration) return;
        e.preventDefault();
        
        const rect = DOM.seekBarWrapper.getBoundingClientRect();
        const trackWidth = rect.width;
        if (e.clientX < rect.left || e.clientX > rect.right || trackWidth <= THUMB_WIDTH) return;
    
        // Convert visual click position to a compensated audio timestamp
        const visualPixelPos = e.clientX - rect.left;
        const audioValue = (visualPixelPos - THUMB_WIDTH / 2) / (trackWidth - THUMB_WIDTH);
        const clampedAudioValue = Math.max(0, Math.min(1, audioValue));
        const timestamp = clampedAudioValue * audioPlayer.duration;
        
        const currentSong = State.getActivePlaylist()[currentSongIndex];
        currentSong.markers = currentSong.markers || [];
        
        // Error prevention: Don't add a new marker too close to an existing one
        if (currentSong.markers.some(m => Math.abs(m.timestamp - timestamp) < 0.5)) {
            UI.showToast("New marker is too close to an existing one.", "info");
            return;
        }
        
        // Update slider value and dispatch 'change' to ensure seeking occurs and isSeeking flag is reset.
        DOM.seekBar.value = clampedAudioValue;
        DOM.seekBar.dispatchEvent(new Event('change'));

        currentSong.markers.push({ id: `marker_${Date.now()}`, timestamp });
        currentSong.markers.sort((a, b) => a.timestamp - b.timestamp);
        UI.renderMarkers(audioPlayer.duration);
        Api.saveMarkers(currentSong.path, currentSong.markers.map(m => m.timestamp));
    });

    let overrideTooltipTimeout = null;

    DOM.playPauseBtn.addEventListener('mouseenter', () => {
        // Only show tooltip if the button is in the overridden state.
        if (!DOM.playPauseBtn.classList.contains('overridden')) return;
        
        // Use a small delay to avoid the tooltip flashing during quick mouse-overs.
        clearTimeout(overrideTooltipTimeout);
        overrideTooltipTimeout = setTimeout(() => {
            const { externalAudioSources } = State.getState();
            if (externalAudioSources && externalAudioSources.length > 0) {
                UI.showOverrideTooltip(externalAudioSources);
            }
        }, 200);
    });

    DOM.playPauseBtn.addEventListener('mouseleave', () => {
        clearTimeout(overrideTooltipTimeout);
        UI.hideOverrideTooltip();
    });

    // --- Audio Element Event Listeners ---
    audioPlayer.onplay = () => {
        // Intercept play command if external audio is active
        if (State.getState().autoPauseEnabled && State.getState().isExternalAudioActive) {
            audioPlayer.pause();
            return;
        }

        // Explicitly resume the AudioContext if it was suspended by the browser.
        // This can happen after a pause, especially one triggered programmatically,
        // and is crucial for the visualizer and time updates to work correctly.
        if (isAudioApiInitialized && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        UI.setPlayPauseIcon('pause');
        DOM.playerPanel.classList.add('is-playing');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        renderVisualizer();
        updateDiscordPresence();
    };
    audioPlayer.onpause = () => {
        // Don't change the icon if the pause is due to an override
        if (!DOM.playPauseBtn.classList.contains('overridden')) {
            UI.setPlayPauseIcon('play');
        }
        DOM.playerPanel.classList.remove('is-playing');
        cancelAnimationFrame(animationFrameId);
        DOM.eqBars.forEach(bar => { bar.style.height = '1%'; }); // Reset bars
        updateDiscordPresence();
    };
    audioPlayer.onended = () => {
        if (State.getState().loopMode === 'song') return; // Handled by audio.loop property
        playNextSong(true);
    };
    audioPlayer.ontimeupdate = () => {
        if (!isSeeking && audioPlayer.duration) {
            DOM.seekBar.value = audioPlayer.currentTime / audioPlayer.duration;
            updateSliderFill(DOM.seekBar);
            DOM.currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
        }
    };
    audioPlayer.onloadedmetadata = () => {
        DOM.totalDurationEl.textContent = formatTime(audioPlayer.duration);
        UI.renderMarkers(audioPlayer.duration);
    };

    // Periodically save playback state to config for recovery on relaunch
    setInterval(() => {
        if (!audioPlayer.paused && audioPlayer.src && audioPlayer.currentTime > 0) {
            const { musicData, currentSongIndex } = State.getState();
            if (currentSongIndex > -1) {
                const song = State.getActivePlaylist()[currentSongIndex];
                if (song) {
                    Api.savePlaybackState({ path: song.path, time: audioPlayer.currentTime, playlist: musicData.activePlaylist })
                        .catch(err => console.warn(`Could not save playback state: ${err.message}`)); // Non-critical, just log
                }
            }
        }
    }, 5000);
}