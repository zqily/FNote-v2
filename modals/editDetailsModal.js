/**
 * @module modals/editDetailsModal
 * Manages the logic for the Edit Details Modal.
 */

import * as DOM from '../dom.js';
import * as UI from '../ui/index.js';
import * as Api from '../api.js';
import * as State from '../state.js';

let songsBeingEdited = [];

function closeEditDetailsModal() {
    DOM.editDetailsModal.classList.remove('visible');
    songsBeingEdited = [];
    DOM.editDetailsTitleInput.value = '';
    DOM.editDetailsArtistInput.value = '';
    DOM.editDetailsCoverImg.src = '';
    DOM.editDetailsTagsContainer.innerHTML = '';
}

/**
 * Populates the tag editing interface within the Edit Details modal.
 * @param {object[]} songs - An array of song objects being edited.
 */
function populateTagsForEditing(songs) {
    const { tagData } = State.getState();
    const container = DOM.editDetailsTagsContainer;
    container.innerHTML = '';

    if (!tagData || !songs.length) return;

    // Get tag IDs from all selected songs to determine union and intersection
    const allSongTagIds = songs.map(s => s.tagIds || []);
    const unionTagIds = new Set(allSongTagIds.flat());
    const intersectionTagIds = new Set(unionTagIds);
    if (songs.length > 1) {
        for (const songTags of allSongTagIds) {
            const songTagSet = new Set(songTags);
            for (const tagId of intersectionTagIds) {
                if (!songTagSet.has(tagId)) {
                    intersectionTagIds.delete(tagId);
                }
            }
        }
    }


    tagData.forEach(category => {
        const categoryBlock = document.createElement('div');
        categoryBlock.className = 'tag-category-block';
        
        const categoryTitle = document.createElement('h5');
        categoryTitle.textContent = category.name;
        categoryBlock.appendChild(categoryTitle);

        const pillsContainer = document.createElement('div');
        pillsContainer.className = 'tag-pills-container';
        categoryBlock.appendChild(pillsContainer);

        // Render existing tags for the category
        category.tags.forEach(tag => {
            const pill = document.createElement('span');
            pill.className = 'tag-pill';
            pill.dataset.tagId = tag.id;
            pill.textContent = tag.name;

            if (intersectionTagIds.has(tag.id)) {
                pill.classList.add('selected');
                pill.dataset.initialState = 'selected';
            } else if (unionTagIds.has(tag.id)) {
                pill.classList.add('indeterminate');
                pill.dataset.initialState = 'indeterminate';
            } else {
                pill.dataset.initialState = 'unselected';
            }

            pill.addEventListener('click', () => {
                // If it's already selected, unselect it.
                if (pill.classList.contains('selected')) {
                    pill.classList.remove('selected');
                    pill.classList.remove('indeterminate');
                } else {
                    // Otherwise (unselected or indeterminate), make it selected.
                    pill.classList.add('selected');
                    pill.classList.remove('indeterminate');
                }
            });
            pillsContainer.appendChild(pill);
        });

        // Add an input for creating new tags
        const newTagInput = document.createElement('input');
        newTagInput.type = 'text';
        newTagInput.className = 'new-tag-input';
        newTagInput.placeholder = `+ Add new ${category.name} tag`;
        newTagInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newTagName = newTagInput.value.trim();
                if (!newTagName) return;
                
                try {
                    const response = await Api.createTag(newTagName, category.id);
                    if (response.status === 'success') {
                        const allTagData = State.getState().tagData;
                        const cat = allTagData.find(c => c.id === category.id);
                        cat.tags.push(response.tag);
                        cat.tags.sort((a, b) => a.name.localeCompare(b.name));
                        State.setTagData(allTagData);
                        populateTagsForEditing(songsBeingEdited); // Re-render tags with new one selected
                        const newTagPill = container.querySelector(`.tag-pill[data-tag-id="${response.tag.id}"]`);
                        if (newTagPill) newTagPill.classList.add('selected');

                        UI.showToast(`Tag "${newTagName}" created.`, 'success');
                    } else {
                        UI.showToast(`Error: ${response.message}`, 'error');
                    }
                } catch(err) {
                    UI.showToast('Failed to create tag.', 'error');
                }
            }
        });
        categoryBlock.appendChild(newTagInput);

        container.appendChild(categoryBlock);
    });
}

/**
 * Opens the Edit Details modal and populates it with data from one or more songs.
 * @param {object[]} songs - The array of song objects to be edited.
 */
export async function openEditDetailsModal(songs) {
    if (!songs || songs.length === 0) return;
    songsBeingEdited = songs;
    const isMulti = songs.length > 1;

    const modalTitle = DOM.editDetailsModal.querySelector('.modal-header h3');
    modalTitle.textContent = isMulti ? `Edit Details for ${songs.length} Songs` : 'Edit Song Details';

    const allSameTitle = songs.every(s => s.name === songs[0].name);
    const allSameArtist = songs.every(s => s.artist === songs[0].artist);

    DOM.editDetailsTitleInput.value = allSameTitle ? (songs[0].name || '') : '';
    DOM.editDetailsTitleInput.placeholder = allSameTitle ? 'Song Title' : 'Multiple values';
    DOM.editDetailsArtistInput.value = allSameArtist ? (songs[0].artist || '') : '';
    DOM.editDetailsArtistInput.placeholder = allSameArtist ? 'Artist Name' : 'Multiple values';
    
    DOM.editDetailsChangeCoverBtn.style.display = isMulti ? 'none' : 'flex';
    DOM.editDetailsCoverImg.src = '';

    const firstSong = songs[0];
    const cachedCover = State.getCoverFromCache(firstSong.path);

    if (cachedCover) {
        DOM.editDetailsCoverImg.src = cachedCover;
    } else if (!isMulti && firstSong.coverPath) {
        try {
            const coverData = await Api.getCoverData(firstSong.path);
            if (coverData) {
                State.setCoverInCache(firstSong.path, coverData);
                DOM.editDetailsCoverImg.src = coverData;
            }
        } catch(e) { 
            console.error(`Could not load cover for edit modal: ${e.message}`);
        }
    }

    populateTagsForEditing(songs);
    
    DOM.editDetailsModal.classList.add('visible');
    feather.replace({ width: '1em', height: '1em' });
}

/**
 * Initializes all event listeners for the Edit Details modal.
 */
export function initEditDetailsModalListeners() {
    DOM.closeEditDetailsModalBtn.addEventListener('click', closeEditDetailsModal);
    DOM.editDetailsCancelBtn.addEventListener('click', closeEditDetailsModal);
    DOM.editDetailsModal.addEventListener('click', (e) => {
        if (e.target === DOM.editDetailsModal) closeEditDetailsModal();
    });

    // Handle changing the cover art
    DOM.editDetailsChangeCoverBtn.addEventListener('click', async () => {
        if (!songsBeingEdited || songsBeingEdited.length !== 1) return;
        const songToEdit = songsBeingEdited[0];

        const originalBtnHTML = DOM.editDetailsChangeCoverBtn.innerHTML;
        DOM.editDetailsChangeCoverBtn.disabled = true;
        DOM.editDetailsChangeCoverBtn.innerHTML = `<span class="spinner"></span>`;

        try {
            const response = await Api.changeSongCover(songToEdit.path);
            if (response?.status === 'success') {
                const songUpdate = response.songUpdate; // { coverPath, coverData }
                DOM.editDetailsCoverImg.src = songUpdate.coverData;

                State.setCoverInCache(songToEdit.path, songUpdate.coverData);
                State.updateSong({
                    path: songToEdit.path,
                    coverPath: songUpdate.coverPath,
                    accentColor: null
                });
                
                UI.showToast('Cover updated successfully.', 'success');
            } else if (response?.status === 'error') {
                UI.showToast(`Error: ${response.message}`, 'error');
            }
        } catch (e) {
            console.error("Failed to change cover:", e);
            UI.showToast('An unexpected error occurred while changing the cover.', 'error');
        } finally {
            DOM.editDetailsChangeCoverBtn.disabled = false;
            DOM.editDetailsChangeCoverBtn.innerHTML = originalBtnHTML;
            feather.replace({ width: '1em', height: '1em' });
        }
    });

    // Handle saving all edited details
    DOM.editDetailsSaveBtn.addEventListener('click', async () => {
        if (!songsBeingEdited || songsBeingEdited.length === 0) return;

        const originalBtnHTML = DOM.editDetailsSaveBtn.innerHTML;
        DOM.editDetailsSaveBtn.disabled = true;
        DOM.editDetailsSaveBtn.innerHTML = `<span class="spinner"></span> Saving...`;

        try {
            const isMulti = songsBeingEdited.length > 1;
            const details = {
                saveToFile: DOM.editDetailsSaveToFileToggle.checked,
            };

            if (isMulti) {
                const tagsToAdd = [];
                const tagsToRemove = [];
                document.querySelectorAll('#edit-details-tags-container .tag-pill').forEach(pill => {
                    const tagId = parseInt(pill.dataset.tagId, 10);
                    const initialState = pill.dataset.initialState;
                    const isSelected = pill.classList.contains('selected');

                    if (isSelected && initialState !== 'selected') {
                        tagsToAdd.push(tagId);
                    } else if (!isSelected && initialState !== 'unselected') {
                        tagsToRemove.push(tagId);
                    }
                });
                details.tagsToAdd = tagsToAdd;
                details.tagsToRemove = tagsToRemove;
            } else {
                details.tagIds = Array.from(document.querySelectorAll('#edit-details-tags-container .tag-pill.selected'))
                                      .map(pill => parseInt(pill.dataset.tagId, 10));
            }

            const titleInputVal = DOM.editDetailsTitleInput.value.trim();
            if (!(DOM.editDetailsTitleInput.placeholder === 'Multiple values' && titleInputVal === '')) {
                details.name = titleInputVal;
            }

            const artistInputVal = DOM.editDetailsArtistInput.value.trim() || null;
            if (!(DOM.editDetailsArtistInput.placeholder === 'Multiple values' && artistInputVal === null)) {
                details.artist = artistInputVal;
            }
            
            const songPaths = songsBeingEdited.map(s => s.path);
            const updatedSongs = await Api.updateSongDetails(songPaths, details);

            if (updatedSongs) {
                updatedSongs.forEach(songData => {
                    if (songData) State.updateSong(songData);
                });
                UI.showToast(`${updatedSongs.length} song(s) updated`, 'success');
                closeEditDetailsModal();
            } else {
                UI.showToast('Failed to save song details.', 'error');
            }
        } catch (e) {
            console.error('Failed to save song details:', e);
            UI.showToast(`An unexpected error occurred while saving: ${e.message}`, 'error');
        } finally {
            DOM.editDetailsSaveBtn.disabled = false;
            DOM.editDetailsSaveBtn.innerHTML = "Save";
        }
    });
}