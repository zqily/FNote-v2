/**
 * @module ui/markers
 * Handles rendering and UI interaction for seek bar markers.
 */
import * as DOM from '../dom.js';
import * as State from '../state.js';
import * as Player from '../player.js';

// The width of the seek bar thumb in pixels, from _components.css, used for positioning calculations.
const THUMB_WIDTH = 18;

/**
 * Handles the mousedown event on a marker to initiate a drag-and-drop operation.
 * @param {MouseEvent} e The mousedown event.
 */
function handleMarkerMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const draggedMarkerEl = e.target.closest('.marker');
    if (!draggedMarkerEl) return;
    const markerId = draggedMarkerEl.dataset.id;
    let isMarkedForDeletion = false;
    const DELETION_THRESHOLD_Y = 30; // pixels

    draggedMarkerEl.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const handleDocumentMouseMove = (moveEvent) => {
        const seekBarRect = DOM.seekBarWrapper.getBoundingClientRect();
        // Clamp the position to within the seek bar bounds
        const newX = Math.max(seekBarRect.left, Math.min(moveEvent.clientX, seekBarRect.right));
        const newPercentage = (newX - seekBarRect.left) / seekBarRect.width;

        draggedMarkerEl.style.left = `${newPercentage * 100}%`;

        // Check for deletion cue
        const isOutsideY = moveEvent.clientY < seekBarRect.top - DELETION_THRESHOLD_Y || moveEvent.clientY > seekBarRect.bottom + DELETION_THRESHOLD_Y;
        isMarkedForDeletion = isOutsideY;
        draggedMarkerEl.classList.toggle('to-be-deleted', isMarkedForDeletion);
    };

    const handleDocumentMouseUp = () => {
        // Cleanup first
        draggedMarkerEl.classList.remove('dragging', 'to-be-deleted');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);

        if (isMarkedForDeletion) {
            Player.deleteMarker(markerId);
        } else {
            const duration = Player.getAudioPlayer().duration;
            const trackWidth = DOM.seekBarWrapper.getBoundingClientRect().width;
            if (duration && trackWidth > THUMB_WIDTH) {
                // Convert the visual drag position back to a compensated audio timestamp
                const visualPercentage = parseFloat(draggedMarkerEl.style.left) / 100;
                const visualPixelPos = visualPercentage * trackWidth;
                const audioValue = (visualPixelPos - THUMB_WIDTH / 2) / (trackWidth - THUMB_WIDTH);
                const newTimestamp = Math.max(0, Math.min(1, audioValue)) * duration;
                Player.updateMarkerTimestamp(markerId, newTimestamp);
            } else {
                // If duration is not available or track is too small, just re-render to snap back
                renderMarkers(Player.getAudioPlayer().duration || 0);
            }
        }
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp, { once: true });
}

export function renderMarkers(duration) {
    const currentSong = State.getActivePlaylist()[State.getState().currentSongIndex];
    DOM.markerContainer.innerHTML = '';
    if (!currentSong?.markers || !duration) return;

    // Use the width of the actual input range element for precision.
    const trackWidth = DOM.seekBar.getBoundingClientRect().width;

    currentSong.markers.forEach(marker => {
        const markerEl = document.createElement('div');
        markerEl.className = 'marker';
        markerEl.dataset.id = marker.id;

        // Add inner elements for new marker style
        const head = document.createElement('div');
        head.className = 'marker-head';
        const tail = document.createElement('div');
        tail.className = 'marker-tail';
        markerEl.append(head, tail);

        // Ensure we don't divide by zero if duration is somehow 0, and clamp value.
        const audioValue = duration > 0 ? Math.max(0, Math.min(1, marker.timestamp / duration)) : 0;

        if (trackWidth > THUMB_WIDTH) {
            // Calculate the pixel position of the thumb's center and convert to a percentage.
            // This correctly accounts for the thumb's true travel range (total width minus one thumb width).
            const thumbCenterPx = (audioValue * (trackWidth - THUMB_WIDTH)) + (THUMB_WIDTH / 2);
            markerEl.style.left = `${(thumbCenterPx / trackWidth) * 100}%`;
        } else {
            // Fallback for very narrow containers where compensation is not possible
            markerEl.style.left = `${audioValue * 100}%`;
        }
        markerEl.title = `Marker at ${new Date(marker.timestamp * 1000).toISOString().slice(14, 19)}`;
        markerEl.classList.toggle('selected', State.getState().selectedMarker?.id === marker.id);

        markerEl.addEventListener('click', e => {
            e.stopPropagation();
            Player.getAudioPlayer().currentTime = marker.timestamp;
            State.setSelectedMarker(marker);
        });

        markerEl.addEventListener('mousedown', handleMarkerMouseDown);

        DOM.markerContainer.appendChild(markerEl);
    });
}

export function updateMarkerSelectionUI() {
    DOM.markerContainer.querySelectorAll('.marker').forEach(el => {
        el.classList.toggle('selected', State.getState().selectedMarker?.id === el.dataset.id);
    });
}