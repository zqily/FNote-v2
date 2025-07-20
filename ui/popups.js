/**
 * @module ui/popups
 * Manages context menus and tooltips.
 */

import * as DOM from '../dom.js';
import * as State from '../state.js';

/**
 * Positions a popup element relative to a trigger element or event coordinates.
 * This function first makes the popup invisible to measure its dimensions,
 * calculates the optimal position, applies it, and then makes the popup visible.
 * @param {HTMLElement} popup - The popup element to position.
 * @param {HTMLElement|{clientX, clientY}} reference - The trigger element or an event object with clientX/Y.
 * @param {object} [options={}] - Positioning options.
 * @param {'context'|'below'|'right'|'above-center'|'tooltip'} [options.position='context'] - The general position relative to the reference.
 * @param {'left'|'right'} [options.align] - Horizontal alignment for 'below' and 'above' positions.
 * @param {number} [options.offset=5] - The gap between the reference and the popup in pixels.
 */
export function positionPopup(popup, reference, options = {}) {
    const { position = 'context', align, offset = 5 } = options;

    const isVisibleStyled = popup.matches('.song-tooltip, .override-tooltip, .import-warning-tooltip');

    // --- Measure ---
    // Temporarily show the element to get its dimensions
    popup.style.visibility = 'hidden';
    if (isVisibleStyled) popup.classList.add('visible');
    else popup.classList.remove('hidden');
    const { offsetWidth: popupWidth, offsetHeight: popupHeight } = popup;
    // Hide it again
    if (isVisibleStyled) popup.classList.remove('visible');
    else popup.classList.add('hidden');
    popup.style.visibility = 'visible';

    // --- Calculate ---
    const { innerWidth, innerHeight } = window;
    let top, left;
    const refRect = reference instanceof HTMLElement ? reference.getBoundingClientRect() : { top: reference.clientY, bottom: reference.clientY, left: reference.clientX, right: reference.clientX, width: 0, height: 0 };

    // Calculate initial position
    switch (position) {
        case 'below':
            top = refRect.bottom + offset;
            left = align === 'right' ? refRect.right - popupWidth : refRect.left;
            break;
        case 'right':
            top = refRect.top;
            left = refRect.right + offset;
            break;
        case 'above-center':
            top = refRect.top - popupHeight - offset;
            left = refRect.left + (refRect.width / 2) - (popupWidth / 2);
            break;
        case 'tooltip':
            top = refRect.top + 20;
            left = refRect.left;
            if (top + popupHeight > innerHeight) top = refRect.top - popupHeight - 10;
            if (left + popupWidth > innerWidth) left = refRect.left - popupWidth;
            break;
        case 'context':
        default:
            top = refRect.top;
            left = refRect.left;
            break;
    }

    // --- Boundary Correction ---
    // Tooltip and its variants have their own boundary logic, skip generic checks for them
    if (!['tooltip', 'above-center'].includes(position)) {
        if (top + popupHeight + offset > innerHeight) top = innerHeight - popupHeight - offset;
        if (left + popupWidth + offset > innerWidth) left = innerWidth - popupWidth - offset;
    }
    if (top < 0) top = offset;
    if (left < 0) left = offset;


    // --- Apply ---
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    if (isVisibleStyled) popup.classList.add('visible');
    else popup.classList.remove('hidden');
}


export function showSongContextMenu(event) {
    const { selectedSongPaths, viewMode } = State.getState();
    const sourceList = viewMode === 'queue' ? State.getState().playQueue : State.getActivePlaylist();
    const selectedSongs = sourceList.filter(s => selectedSongPaths.includes(s.path));

    const isMulti = selectedSongs.length > 1;
    const isAnyMissing = selectedSongs.some(s => s.isMissing);

    DOM.editDetailsBtn.classList.toggle('disabled', isAnyMissing || viewMode === 'queue');
    DOM.playNextBtn.classList.toggle('disabled', isAnyMissing || viewMode === 'queue');
    DOM.addToQueueBtn.classList.toggle('disabled', isAnyMissing || viewMode === 'queue');
    DOM.showInExplorerBtn.classList.toggle('disabled', isMulti || isAnyMissing);
    
    const deleteText = viewMode === 'queue'
        ? `Remove ${isMulti ? selectedSongPaths.length : ''} from Queue`.trim()
        : isAnyMissing
            ? `Remove ${isMulti ? selectedSongPaths.length : ''} From Library`.trim()
            : `Delete ${isMulti ? selectedSongPaths.length : ''} Song(s)`.trim().replace('(s)', isMulti ? 's' : '');
    DOM.deleteBtn.querySelector('span').textContent = deleteText;

    positionPopup(DOM.songContextMenu, event);
    feather.replace({ width: '1em', height: '1em' });
}

export function showPlaylistContextMenu(event, playlistName) {
    State.setContextMenuTarget(playlistName);
    positionPopup(DOM.playlistContextMenu, event);
    feather.replace({ width: '1em', height: '1em' });
}

export function showSongTooltip(song, event) {
    const tooltip = DOM.songTooltip;
    const { tagData } = State.getState();

    if (!song.tagIds?.length || !tagData) {
        tooltip.innerHTML = `<div class="tooltip-no-tags">No tags assigned.</div>`;
    } else {
        const tagsByCat = tagData.reduce((acc, cat) => {
            const tagsInCat = cat.tags.filter(t => song.tagIds.includes(t.id)).map(t => t.name);
            if (tagsInCat.length > 0) acc.push(`<h5>${cat.name}</h5><div class="tooltip-pills-container">${tagsInCat.map(name => `<span class="tooltip-tag-pill">${name}</span>`).join('')}</div>`);
            return acc;
        }, []);
        tooltip.innerHTML = `<div class="tooltip-category">${tagsByCat.join('</div><div class="tooltip-category">')}</div>` || `<div class="tooltip-no-tags">No tags assigned.</div>`;
    }

    positionPopup(tooltip, event, { position: 'tooltip' });
}

export function hideSongContextMenu() { DOM.songContextMenu.classList.add('hidden'); }
export function hidePlaylistContextMenu() { DOM.playlistContextMenu.classList.add('hidden'); }
export function hideSongTooltip() { DOM.songTooltip.classList.remove('visible'); }

/**
 * Shows a tooltip above the play/pause button listing apps causing an audio override.
 * @param {string[]} sources - An array of application names.
 */
export function showOverrideTooltip(sources) {
    const tooltip = DOM.overrideTooltip;
    tooltip.innerHTML = `<strong>Playback Paused By:</strong><ul>${sources.map(s => `<li>${s}</li>`).join('')}</ul>`;
    positionPopup(tooltip, DOM.playPauseBtn, { position: 'above-center', offset: 10 });
}

/**
 * Hides the override tooltip.
 */
export function hideOverrideTooltip() {
    DOM.overrideTooltip.classList.remove('visible');
}

/**
 * Shows a tooltip for duplicate items in the import modal.
 * @param {string} text - The text to display in the tooltip.
 * @param {HTMLElement} referenceElement - The element to position the tooltip relative to.
 */
export function showImportWarningTooltip(text, referenceElement) {
    const tooltip = DOM.importWarningTooltip;
    if (!tooltip) return;
    tooltip.textContent = text;
    // Position it like the override tooltip, but a bit closer
    positionPopup(tooltip, referenceElement, { position: 'above-center', offset: 8 });
}

/**
 * Hides the import warning tooltip.
 */
export function hideImportWarningTooltip() {
    const tooltip = DOM.importWarningTooltip;
    if (!tooltip) return;
    tooltip.classList.remove('visible');
}