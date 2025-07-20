/**
 * Frontend logic for the mini-player window.
 */

const DOM = {
    body: document.getElementById('mini-player-body'),
    container: document.getElementById('mini-player-container'),
    albumArt: document.getElementById('mini-album-art'),
    title: document.getElementById('mini-song-title'),
    artist: document.getElementById('mini-song-artist'),
    seekBar: document.getElementById('mini-seek-bar'),
    currentTime: document.getElementById('mini-current-time'),
    totalDuration: document.getElementById('mini-total-duration'),
    shuffleBtn: document.getElementById('mini-shuffle-btn'),
    prevBtn: document.getElementById('mini-prev-btn'),
    playPauseBtn: document.getElementById('mini-play-pause-btn'),
    nextBtn: document.getElementById('mini-next-btn'),
    repeatBtn: document.getElementById('mini-repeat-btn'),
    maximizeBtn: document.getElementById('mini-maximize-btn'),
    volumeToggleBtn: document.getElementById('mini-volume-toggle-btn'),
    volumeSlider: document.getElementById('mini-volume-slider'),
    overrideTooltip: document.getElementById('override-tooltip'),
};

let isSeeking = false;
let isExpanded = false;
let externalAudioSources = [];
let overrideTooltipTimeout = null;

// --- Utilities (cannot import from main JS context) ---
const ICONS = {};
const iconNamesToCache = ['play', 'pause', 'skip-back', 'skip-forward', 'maximize-2', 'volume-x', 'volume-1', 'volume-2'];

function cacheIcons() {
    if (!window.feather) return;
    iconNamesToCache.forEach(name => {
        if (feather.icons[name]) {
            ICONS[name] = feather.icons[name].toSvg();
        }
    });
}

function setIcon(element, iconName) {
    if (ICONS[iconName]) {
        element.innerHTML = ICONS[iconName];
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function updateSliderFill(slider) {
    const percentage = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--progress-percent', `${percentage}%`);
}
// --- End Utilities ---

function setPlayPauseIcon(isPlaying) {
    setIcon(DOM.playPauseBtn, isPlaying ? 'pause' : 'play');
}

function updateShuffleButtonUI(isShuffling) {
    DOM.shuffleBtn.classList.toggle('active', isShuffling);
}

function updateRepeatButtonUI(loopMode) {
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

function updateVolumeIcon(volume) {
    let iconName = 'volume-2';
    if (volume === 0) iconName = 'volume-x';
    else if (volume < 50) iconName = 'volume-1';
    setIcon(DOM.volumeToggleBtn, iconName);
}


function setAccentColors(colorObj) {
    const props = colorObj ? {
        '--accent-color': `rgb(${colorObj.r}, ${colorObj.g}, ${colorObj.b})`,
        '--accent-hover': `rgb(${[colorObj.r, colorObj.g, colorObj.b].map(c => Math.min(255, c + 20)).join(',')})`,
        '--glow-color': `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, 0.7)`
    } : {
        '--accent-color': '#1DB954',
        '--accent-hover': '#1ED760',
        '--glow-color': 'rgba(29, 185, 84, 0.7)'
    };
    for (const [prop, value] of Object.entries(props)) {
        document.body.style.setProperty(prop, value);
    }
}

// --- Tooltip Helpers ---
function positionPopup(popup, reference) {
    popup.style.visibility = 'hidden';
    popup.classList.add('visible');
    const { offsetWidth: popupWidth, offsetHeight: popupHeight } = popup;
    popup.classList.remove('visible');
    popup.style.visibility = 'visible';

    const refRect = reference.getBoundingClientRect();
    const offset = 10;
    
    let top = refRect.top - popupHeight - offset;
    let left = refRect.left + (refRect.width / 2) - (popupWidth / 2);

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.classList.add('visible');
}

function showOverrideTooltip(sources) {
    const tooltip = DOM.overrideTooltip;
    tooltip.innerHTML = `<strong>Playback Paused By:</strong><ul>${sources.map(s => `<li>${s}</li>`).join('')}</ul>`;
    positionPopup(tooltip, DOM.playPauseBtn);
}

function hideOverrideTooltip() {
    DOM.overrideTooltip.classList.remove('visible');
}
// --- End Tooltip Helpers ---

async function updateUI(state) {
    if (!state) return;

    // Determine the visual playing state, which differs from actual state during an override
    const isVisuallyPlaying = state.isExternalAudioActive ? state.wasPlayingBeforeExternalAudio : state.isPlaying;

    DOM.body.classList.toggle('is-playing', !!state.isPlaying);
    DOM.playPauseBtn.classList.toggle('overridden', state.isExternalAudioActive);
    externalAudioSources = state.externalAudioSources || []; // Store sources for tooltip

    if (state.song) {
        DOM.title.textContent = state.song.name || 'Untitled';
        DOM.artist.textContent = state.song.artist || 'Unknown Artist';
        if (state.coverData) {
            DOM.albumArt.src = state.coverData;
        } else {
            DOM.albumArt.src = '';
        }
        setAccentColors(state.song.accentColor || null);
    } else {
        DOM.title.textContent = 'No Song';
        DOM.artist.textContent = '';
        DOM.albumArt.src = '';
        setAccentColors(null);
    }

    setPlayPauseIcon(isVisuallyPlaying);
    updateShuffleButtonUI(state.isShuffling);
    updateRepeatButtonUI(state.loopMode);

    if (!isSeeking && state.duration) {
        DOM.seekBar.value = state.currentTime / state.duration;
        updateSliderFill(DOM.seekBar);
    }
    DOM.currentTime.textContent = formatTime(state.currentTime || 0);
    DOM.totalDuration.textContent = formatTime(state.duration || 0);

    if (state.volume !== undefined) {
        DOM.volumeSlider.value = state.volume;
        updateSliderFill(DOM.volumeSlider);
        updateVolumeIcon(state.volume);
    }
}

let hoverTimer = null;

/**
 * Manages the hover state to expand or collapse the player, using a single timer
 * to prevent race conditions and flickering.
 * @param {boolean} isHovering - True if the mouse is entering the window.
 */
function handleHoverChange(isHovering) {
    clearTimeout(hoverTimer);
    if (isHovering) {
        // Use a short delay to expand, preventing expansion on quick mouse-overs.
        hoverTimer = setTimeout(expandPlayer, 50);
    } else {
        // Shorten collapse delay to feel more responsive and align with animation.
        hoverTimer = setTimeout(collapsePlayer, 100);
    }
}

const expandPlayer = () => {
    if (isExpanded) return;
    isExpanded = true;
    DOM.body.classList.add('expanded');
    pywebview.api.set_mini_player_collapsed(false);
};

const collapsePlayer = () => {
    if (!isExpanded) return;
    isExpanded = false;
    DOM.body.classList.remove('expanded');
    pywebview.api.set_mini_player_collapsed(true);
};

const initEventListeners = () => {
    DOM.playPauseBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('togglePlayPause'));
    DOM.prevBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('playPrevSong'));
    DOM.nextBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('playNextSong'));
    DOM.shuffleBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('toggleShuffle'));
    DOM.repeatBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('toggleRepeat'));

    DOM.maximizeBtn.addEventListener('click', () => pywebview.api.toggle_mini_player(false));

    DOM.seekBar.addEventListener('mousedown', () => { isSeeking = true; });
    DOM.seekBar.addEventListener('change', (e) => {
        pywebview.api.proxy_command_to_main('seekToPercentage', JSON.stringify([parseFloat(e.target.value)]));
        isSeeking = false;
        updateSliderFill(e.target);
    });
    DOM.seekBar.addEventListener('input', (e) => {
        updateSliderFill(e.target);
    });

    DOM.volumeToggleBtn.addEventListener('click', () => pywebview.api.proxy_command_to_main('toggleMute'));
    DOM.volumeSlider.addEventListener('input', (e) => {
        const newVolume = parseInt(e.target.value, 10);
        pywebview.api.proxy_command_to_main('setVolume', JSON.stringify([newVolume]));
    });

    DOM.playPauseBtn.addEventListener('mouseenter', () => {
        if (!DOM.playPauseBtn.classList.contains('overridden')) return;
        clearTimeout(overrideTooltipTimeout);
        overrideTooltipTimeout = setTimeout(() => {
            if (externalAudioSources.length > 0) {
                showOverrideTooltip(externalAudioSources);
            }
        }, 200);
    });

    DOM.playPauseBtn.addEventListener('mouseleave', () => {
        clearTimeout(overrideTooltipTimeout);
        hideOverrideTooltip();
    });
};

const initHoverListeners = () => {
    DOM.body.addEventListener('mouseenter', () => handleHoverChange(true));
    DOM.body.addEventListener('mouseleave', () => handleHoverChange(false));
};

window.addEventListener('pywebviewready', async () => {
    feather.replace();
    cacheIcons();
    initEventListeners();
    initHoverListeners();

    // Global handler for state updates from the main window
    window.handleStateUpdate = (payload) => {
        const { key, value } = payload;
        switch (key) {
            case 'isShuffling':
                updateShuffleButtonUI(value);
                break;
            case 'loopMode':
                updateRepeatButtonUI(value);
                break;
            case 'volume':
                DOM.volumeSlider.value = value;
                updateSliderFill(DOM.volumeSlider);
                updateVolumeIcon(value);
                break;
            case 'fullState':
                updateUI(value);
                break;
            case 'timeUpdate':
                if (!isSeeking && value.duration) {
                    DOM.seekBar.value = value.currentTime / value.duration;
                    updateSliderFill(DOM.seekBar);
                }
                DOM.currentTime.textContent = formatTime(value.currentTime || 0);
                DOM.totalDuration.textContent = formatTime(value.duration || 0);
                break;
            // Add other granular cases as needed
        }
    };

    // Get initial state
    try {
        const initialState = await pywebview.api.get_current_player_state();
        updateUI(initialState);
    } catch (e) {
        console.error("Failed to get initial state for mini-player:", e);
    }

    // Start in a collapsed state
    isExpanded = true; // Set to true to allow the initial collapsePlayer call to run
    collapsePlayer();
});