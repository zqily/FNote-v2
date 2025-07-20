/**
 * @module modals/importModal
 * Manages the logic for the Import Modal.
 */

import * as DOM from '../dom.js';
import * as UI from '../ui/index.js';
import * as Api from '../api.js';
import * as Playlist from '../playlist.js';

let currentImportType = 'url'; // 'url' or 'files'
let originalUrlForDownload = '';

function closeModal() {
    DOM.importModal.classList.remove('visible');
}

/**
 * Manages the visibility of import modal sections and updates the header.
 * @param {'method'|'url'|'playlistSelection'} sectionName The section to show.
 * @param {object} [options] - Configuration for the section, e.g., data to render.
 */
function showImportSection(sectionName, options = {}) {
    // Hide all sections first
    DOM.importMethodSection.classList.add('hidden');
    DOM.urlImportSection.classList.add('hidden');
    DOM.playlistSelectionSection.classList.add('hidden');

    switch(sectionName) {
        case 'method':
            DOM.importMethodSection.classList.remove('hidden');
            DOM.importModalTitle.textContent = 'Import Music';
            DOM.modalBackBtn.classList.add('hidden');
            break;
        case 'url':
            DOM.urlImportSection.classList.remove('hidden');
            DOM.importModalTitle.textContent = 'Import from URL';
            DOM.modalBackBtn.classList.remove('hidden');
            break;
        case 'playlistSelection':
            DOM.playlistSelectionSection.classList.remove('hidden');
            DOM.importModalTitle.textContent = 'Select Items to Import';
            DOM.modalBackBtn.classList.remove('hidden');
            
            currentImportType = options.type;
            if (options.type === 'files') {
                renderFileSelection(options.data);
            } else { // 'url'
                originalUrlForDownload = options.url;
                renderPlaylistSelection(options.data);
            }
            break;
    }
}


/**
 * Updates the state of the "Download Selected" button and "Select All" checkbox
 * based on the current selection in the URL playlist import view.
 */
function updateDownloadSelectionState() {
    const allItemCheckboxes = DOM.playlistSelectionGroupsContainer.querySelectorAll('input[type="checkbox"]:not(.group-select-checkbox):not(:disabled)');
    const checkedItemCheckboxes = DOM.playlistSelectionGroupsContainer.querySelectorAll('input[type="checkbox"]:not(.group-select-checkbox):checked');

    DOM.downloadSelectedBtn.disabled = checkedItemCheckboxes.length === 0;

    // Update global "Select All" checkbox
    if (checkedItemCheckboxes.length === 0) {
        DOM.selectAllCheckbox.checked = false;
        DOM.selectAllCheckbox.indeterminate = false;
    } else if (checkedItemCheckboxes.length === allItemCheckboxes.length) {
        DOM.selectAllCheckbox.checked = true;
        DOM.selectAllCheckbox.indeterminate = false;
    } else {
        DOM.selectAllCheckbox.checked = false;
        DOM.selectAllCheckbox.indeterminate = true;
    }

    // Update each group's checkbox
    const groups = DOM.playlistSelectionGroupsContainer.querySelectorAll('.playlist-group');
    groups.forEach(group => {
        const groupCheckbox = group.querySelector('.group-select-checkbox');
        if (!groupCheckbox || groupCheckbox.disabled) return;
        
        const groupItemCheckboxes = group.querySelectorAll('input[type="checkbox"]:not(.group-select-checkbox)');
        const checkedGroupItemCheckboxes = group.querySelectorAll('input[type="checkbox"]:not(.group-select-checkbox):checked');
        
        if (checkedGroupItemCheckboxes.length === 0) {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = false;
        } else if (checkedGroupItemCheckboxes.length === groupItemCheckboxes.length) {
            groupCheckbox.checked = true;
            groupCheckbox.indeterminate = false;
        } else {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = true;
        }
    });
}

/**
 * Renders the list of tracks from a fetched URL playlist for user selection.
 * @param {object} data - The metadata object from the backend, containing playlist_title and entries.
 */
function renderPlaylistSelection(data) {
    const container = DOM.playlistSelectionGroupsContainer;
    DOM.playlistSelectionTitle.textContent = data.playlist_title;
    container.innerHTML = '';
    DOM.selectionDownloadStatus.textContent = '';
    DOM.downloadSelectedBtn.disabled = true;
    DOM.downloadSelectedBtn.innerHTML = '<i data-feather="download"></i> Download Selected';
    
    // 1. Partition entries into groups
    const newEntries = [];
    const duplicateEntries = [];
    const unavailableEntries = [];

    data.entries.forEach((entry, i) => {
        const entryWithIndex = { ...entry, originalIndex: i + 1 };
        if (entry.is_unavailable) {
            unavailableEntries.push(entryWithIndex);
        } else if (entry.is_duplicate) {
            duplicateEntries.push(entryWithIndex);
        } else {
            newEntries.push(entryWithIndex);
        }
    });
    
    const groupsData = [];
    if (newEntries.length > 0) groupsData.push({ title: 'New Videos', entries: newEntries, selectable: true, preselected: true });
    if (duplicateEntries.length > 0) groupsData.push({ title: 'Already in Library', entries: duplicateEntries, selectable: true, preselected: false });
    if (unavailableEntries.length > 0) groupsData.push({ title: 'Unavailable Videos', entries: unavailableEntries, selectable: false, preselected: false });

    // 2. Render as groups or a flat list
    if (groupsData.length <= 1) {
        const ul = document.createElement('ul');
        ul.className = 'playlist-selection-list';
        data.entries.forEach((entry, i) => {
            const li = createSongListItem({ ...entry, originalIndex: i + 1 }, !entry.is_unavailable, !entry.is_duplicate && !entry.is_unavailable);
            ul.appendChild(li);
        });
        container.appendChild(ul);
    } else {
        groupsData.forEach(groupInfo => {
            const groupElement = createGroupElement(groupInfo);
            container.appendChild(groupElement);
        });
    }

    feather.replace({ width: '1em', height: '1em' });
    updateDownloadSelectionState();
}

function createSongListItem(entry, isSelectable, isPreselected) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.index = entry.originalIndex; 

        const titleSpan = document.createElement('span');
        titleSpan.textContent = entry.title;

        label.append(checkbox, titleSpan);

        if (!isSelectable) { // Unavailable
            checkbox.disabled = true;
            checkbox.checked = false;
            li.classList.add('is-duplicate'); // Use same styling for unavailable items
            const warning = document.createElement('span');
            warning.className = 'duplicate-warning';
            warning.innerHTML = `<i data-feather="slash"></i>`;
            
            warning.addEventListener('mouseenter', (e) => {
                UI.showImportWarningTooltip('This video is unavailable (deleted or private).', e.currentTarget);
            });
            warning.addEventListener('mouseleave', () => {
                UI.hideImportWarningTooltip();
            });
            
            label.appendChild(warning);
        } else if (entry.is_duplicate) {
            checkbox.checked = false;
            li.classList.add('is-duplicate');
            
            const warning = document.createElement('span');
            warning.className = 'duplicate-warning';
            warning.innerHTML = `<i data-feather="alert-triangle"></i>`;
            warning.addEventListener('mouseenter', (e) => {
                UI.showImportWarningTooltip('A song with this title already exists in your library.', e.currentTarget);
            });
            warning.addEventListener('mouseleave', () => {
                UI.hideImportWarningTooltip();
            });
            label.appendChild(warning);
        } else {
            checkbox.checked = isPreselected;
        }

        li.appendChild(label);
    return li;
}

function createGroupElement({ title, entries, selectable, preselected }) {
    const details = document.createElement('details');
    details.className = 'playlist-group';
    details.open = true; // Open by default

    const summary = document.createElement('summary');
    summary.className = 'playlist-group-summary';
    
    const summaryLabel = document.createElement('label');
    summaryLabel.className = 'checkbox-label';
    summaryLabel.addEventListener('click', e => e.preventDefault()); // Prevent details toggle when clicking label

    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.className = 'group-select-checkbox';
    if (!selectable) groupCheckbox.disabled = true;

    const summaryTitle = document.createElement('span');
    summaryTitle.textContent = `${title} (${entries.length})`;

    summaryLabel.append(groupCheckbox, summaryTitle);
    summary.appendChild(summaryLabel);

    const ul = document.createElement('ul');
    ul.className = 'playlist-selection-list';

    entries.forEach(entry => {
        const li = createSongListItem(entry, selectable, preselected);
        ul.appendChild(li);
    });
    
    details.append(summary, ul);

    groupCheckbox.addEventListener('change', () => {
        const itemCheckboxes = ul.querySelectorAll('input[type="checkbox"]');
        itemCheckboxes.forEach(cb => { cb.checked = groupCheckbox.checked; });
        updateDownloadSelectionState();
    });

    return details;
}

/**
 * Renders the list of local files for user selection.
 * @param {object[]} entries - The candidate file objects from the backend.
 */
function renderFileSelection(entries) {
    DOM.playlistSelectionTitle.textContent = "Review Files to Import";
    const container = DOM.playlistSelectionGroupsContainer;
    container.innerHTML = '';

    DOM.selectionDownloadStatus.textContent = '';
    DOM.downloadSelectedBtn.disabled = true;
    DOM.downloadSelectedBtn.innerHTML = '<i data-feather="plus-circle"></i> Import Selected';

    const ul = document.createElement('ul');
    ul.className = 'playlist-selection-list';

    entries.forEach((entry) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.sourcePath = entry.source_path;

        const titleSpan = document.createElement('span');
        const displayText = entry.artist ? `${entry.artist} - ${entry.title}` : entry.title;
        titleSpan.textContent = displayText;

        label.append(checkbox, titleSpan);

        if (entry.is_duplicate) {
            checkbox.checked = false; // Uncheck duplicates
            li.classList.add('is-duplicate');
            const warning = document.createElement('span');
            warning.className = 'duplicate-warning';
            warning.innerHTML = `<i data-feather="alert-triangle"></i>`;

            warning.addEventListener('mouseenter', (e) => {
                UI.showImportWarningTooltip('A song with this title already exists in your library.', e.currentTarget);
            });
            warning.addEventListener('mouseleave', () => {
                UI.hideImportWarningTooltip();
            });

            label.appendChild(warning);
        } else {
            checkbox.checked = true; // Check non-duplicates
        }

        li.appendChild(label);
        ul.appendChild(li);
    });

    container.appendChild(ul);

    feather.replace({ width: '1em', height: '1em' });
    updateDownloadSelectionState();
}


export function initImportModalListeners() {
    DOM.importBtn.addEventListener('click', () => {
        showImportSection('method');
        DOM.urlInput.value = '';
        DOM.urlStatus.textContent = '';
        DOM.fetchUrlBtn.disabled = false;
        DOM.importModal.classList.add('visible');
        feather.replace({ width: '1em', height: '1em' });
    });

    DOM.closeModalBtn.addEventListener('click', closeModal);
    DOM.importModal.addEventListener('click', (e) => { if (e.target === DOM.importModal) closeModal(); });

    DOM.modalBackBtn.addEventListener('click', () => {
        // Check which section is currently visible to determine where to go "back" to.
        if (!DOM.playlistSelectionSection.classList.contains('hidden')) {
            const fromType = currentImportType;
            showImportSection(fromType === 'files' ? 'method' : 'url');
            DOM.urlStatus.textContent = '';
        } else if (!DOM.urlImportSection.classList.contains('hidden')) {
            showImportSection('method');
            DOM.urlInput.value = '';
            DOM.urlStatus.textContent = '';
        }
    });

    DOM.modalImportFilesBtn.addEventListener('click', async () => {
        const originalContent = DOM.modalImportFilesBtn.innerHTML;
        DOM.modalImportFilesBtn.disabled = true;
        DOM.modalImportUrlBtn.disabled = true;
        DOM.modalImportFilesBtn.innerHTML = `<span class="spinner"></span> Reading...`;
    
        try {
            const response = await Api.importFromFiles();
            if (response?.status === 'success' && response.entries) {
                if (response.entries.length > 0) {
                    showImportSection('playlistSelection', { type: 'files', data: response.entries });
                } else {
                    closeModal(); // No files selected
                }
            }
            // If status is 'cancelled', do nothing.
        } catch (e) {
            console.error("Error importing songs from files:", e);
            UI.showToast("An error occurred during file import.", 'error');
        } finally {
            DOM.modalImportFilesBtn.disabled = false;
            DOM.modalImportUrlBtn.disabled = false;
            DOM.modalImportFilesBtn.innerHTML = originalContent;
            feather.replace({ width: '1em', height: '1em' });
        }
    });

    DOM.modalImportUrlBtn.addEventListener('click', () => {
        showImportSection('url');
    });

    DOM.fetchUrlBtn.addEventListener('click', async () => {
        const url = DOM.urlInput.value.trim();
        if (!url) { DOM.urlStatus.textContent = 'Please enter a URL.'; return; }
        
        let downloadStarted = false;
        const originalContent = DOM.fetchUrlBtn.innerHTML;
        DOM.fetchUrlBtn.disabled = true;
        DOM.modalBackBtn.disabled = true;
        DOM.fetchUrlBtn.innerHTML = `<span class="spinner"></span> Fetching...`;
        DOM.urlStatus.textContent = 'Fetching metadata...';
        
        try {
            originalUrlForDownload = url;
            const response = await Api.fetchUrlMetadata(url);

            if (response?.status === 'success') {
                const isSingleAvailableNonDuplicate = response.entries?.length === 1 && !response.entries[0].is_duplicate && !response.entries[0].is_unavailable;

                if (isSingleAvailableNonDuplicate) {
                    // It's a single, available, non-duplicate video. Download it immediately.
                    const downloadStatus = await Api.startUrlDownload(originalUrlForDownload, [1]);
                    
                    if (downloadStatus?.status === 'processing') {
                        downloadStarted = true;
                        closeModal();
                    } else {
                        const errorMsg = downloadStatus?.message || 'Download failed to start.';
                        DOM.urlStatus.textContent = `Error: ${errorMsg}`;
                        UI.showGlobalStatus(`Download failed: ${errorMsg}`, { isActive: false, isError: true });
                    }
                } else if (response.entries?.length > 0) {
                    // It's a playlist, or a single duplicate/unavailable video. Show selection screen.
                    showImportSection('playlistSelection', { type: 'url', url: originalUrlForDownload, data: response });
                } else {
                    DOM.urlStatus.textContent = `Error: No valid videos found at this URL.`;
                }
            } else {
                DOM.urlStatus.textContent = `Error: ${response?.message || 'Could not fetch metadata.'}`;
            }
        } catch (e) {
            console.error("Error fetching URL metadata:", e);
            DOM.urlStatus.textContent = 'A critical error occurred.';
        } finally {
            DOM.modalBackBtn.disabled = false;
            if (!downloadStarted) {
                DOM.fetchUrlBtn.disabled = false;
                DOM.fetchUrlBtn.innerHTML = originalContent;
            }
        }
    });

    DOM.downloadSelectedBtn.addEventListener('click', async () => {
        const selectedCheckboxes = DOM.playlistSelectionGroupsContainer.querySelectorAll('input[type="checkbox"]:checked:not(.group-select-checkbox)');
        if (selectedCheckboxes.length === 0) return;

        let operationStarted = false;
        const originalContent = DOM.downloadSelectedBtn.innerHTML;
        DOM.modalBackBtn.disabled = true;
        DOM.downloadSelectedBtn.disabled = true;
        DOM.selectAllCheckbox.disabled = true;
        DOM.downloadSelectedBtn.innerHTML = `<span class="spinner"></span> Starting...`;

        try {
            if (currentImportType === 'url') {
                const indices = Array.from(selectedCheckboxes).map(cb => parseInt(cb.dataset.index, 10));
                
                const response = await Api.startUrlDownload(originalUrlForDownload, indices);
                
                if (response?.status === 'processing') {
                    operationStarted = true;
                    closeModal();
                } else {
                    const errorMsg = response?.message || 'Download failed to start.';
                    DOM.selectionDownloadStatus.textContent = `Error: ${errorMsg}`;
                    UI.showGlobalStatus(`Download failed: ${errorMsg}`, { isActive: false, isError: true });
                }
            } else { // 'files'
                const sourcePaths = Array.from(selectedCheckboxes).map(cb => cb.dataset.sourcePath);
                UI.showGlobalStatus(`Importing ${sourcePaths.length} file(s)...`, { isActive: true });

                const finalResponse = await Api.finalizeFileImport(sourcePaths);
                if (finalResponse?.songs?.length > 0) {
                    await Playlist.addSongsToActivePlaylist(finalResponse.songs);
                    UI.showGlobalStatus(`Imported ${finalResponse.songs.length} song(s).`, { isActive: false });
                    closeModal();
                } else {
                    UI.showGlobalStatus('Import failed or no new songs were added.', { isActive: false, isError: true });
                }
                // No need for operationStarted flag here as it's not a background process
            }
        } catch (e) {
            console.error("Error during import/download:", e);
            const errorMsg = e.message || "An unknown error occurred.";
            DOM.selectionDownloadStatus.textContent = `Error: ${errorMsg}`;
            UI.showGlobalStatus(`Error: ${errorMsg}`, { isActive: false, isError: true });
        } finally {
            DOM.downloadSelectedBtn.innerHTML = originalContent;
            DOM.modalBackBtn.disabled = false;
            DOM.selectAllCheckbox.disabled = false;
            if (!operationStarted) {
                updateDownloadSelectionState();
            }
        }
    });

    DOM.selectAllCheckbox.addEventListener('change', () => {
        const allCheckboxes = DOM.playlistSelectionGroupsContainer.querySelectorAll('input[type="checkbox"]:not(:disabled)');
        allCheckboxes.forEach(cb => { cb.checked = DOM.selectAllCheckbox.checked; });
        updateDownloadSelectionState();
    });

    DOM.playlistSelectionGroupsContainer.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"]')) {
            updateDownloadSelectionState();
        }
    });
}