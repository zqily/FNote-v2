/**
 * @module modals/tagManagementModal
 * Manages the logic for the Tag Management Modal.
 */

import * as DOM from '../dom.js';
import * as UI from '../ui/index.js';
import * as Api from '../api.js';
import * as State from '../state.js';

let draggedTagId = null;

function handleRename(tagId, currentName, nameSpan) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'managed-tag-pill-name-input';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    
    const save = async () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            try {
                const response = await Api.renameTag(tagId, newName);
                UI.showToast(`Tag renamed to "${newName}".`, 'success');
                State.setTagData(response.tagData); // Update state with fresh data
                renderManagedTags(); // Re-render this modal
            } catch (e) {
                UI.showToast(`Error: ${e.message}`, 'error');
                renderManagedTags(); // Re-render on error to restore original name
            }
        } else {
             renderManagedTags();
        }
    };
    
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
            renderManagedTags(); // Re-render to cancel
        }
    });
}

async function handleDelete(tagId, tagName) {
    const confirmed = await UI.showConfirmation(`Are you sure you want to delete the tag "${tagName}"? It will be removed from all songs. This cannot be undone.`);
    if (confirmed) {
        try {
            const response = await Api.deleteTag(tagId);
            UI.showToast(`Tag "${tagName}" deleted.`, 'success');
            State.setTagData(response.tagData);
            renderManagedTags();
        } catch (e) {
            UI.showToast(`Error: ${e.message}`, 'error');
        }
    }
}

async function handleMerge(sourceTagId, destTagId) {
    const allTags = State.getState().tagData.flatMap(c => c.tags);
    const sourceTag = allTags.find(t => t.id === sourceTagId);
    const destTag = allTags.find(t => t.id === destTagId);

    if (!sourceTag || !destTag) return;

    const confirmed = await UI.showConfirmation(`Merge the tag "${sourceTag.name}" into "${destTag.name}"? All songs with "${sourceTag.name}" will be given the "${destTag.name}" tag, and "${sourceTag.name}" will be deleted. This cannot be undone.`, { okText: 'Merge' });

    if (confirmed) {
        try {
            const response = await Api.mergeTags(sourceTagId, destTagId);
            UI.showToast(`Tags merged successfully.`, 'success');
            
            // Update tag data with the new list from the backend
            State.setTagData(response.tagData);

            // Update all affected songs in the state cache
            if (response.updatedSongsMap) {
                for (const songPath in response.updatedSongsMap) {
                    State.updateSong(response.updatedSongsMap[songPath]);
                }
            }

            // Re-render the modal with the new tag data
            renderManagedTags();
        } catch (e) {
            UI.showToast(`Error: ${e.message}`, 'error');
        }
    }
}

function renderManagedTags() {
    const { tagData } = State.getState();
    const container = DOM.tagManagementListContainer;
    container.innerHTML = '';
    
    if (!tagData) return;
    
    tagData.forEach(category => {
        const categoryBlock = document.createElement('div');
        categoryBlock.className = 'managed-tag-category-block';

        const categoryTitle = document.createElement('h5');
        categoryTitle.textContent = category.name;
        categoryBlock.appendChild(categoryTitle);
        
        const pillsContainer = document.createElement('div');
        pillsContainer.className = 'managed-tags-container';
        categoryBlock.appendChild(pillsContainer);

        category.tags.forEach(tag => {
            const pill = document.createElement('div');
            pill.className = 'managed-tag-pill';
            pill.dataset.tagId = tag.id;
            pill.dataset.categoryId = category.id;
            pill.classList.toggle('is-default', !!tag.is_default);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'managed-tag-pill-name';
            nameSpan.textContent = tag.name;
            
            if (!tag.is_default) {
                pill.draggable = true;
                
                nameSpan.addEventListener('click', () => handleRename(tag.id, tag.name, nameSpan));
                
                const deleteBtn = document.createElement('div');
                deleteBtn.className = 'pill-control delete';
                deleteBtn.title = `Delete "${tag.name}"`;
                deleteBtn.innerHTML = `<i data-feather="trash-2"></i>`;
                deleteBtn.addEventListener('click', () => handleDelete(tag.id, tag.name));
                
                pill.append(nameSpan, deleteBtn);
            } else {
                pill.draggable = false;
                pill.append(nameSpan);
            }

            pillsContainer.appendChild(pill);
        });

        container.appendChild(categoryBlock);
    });
    
    feather.replace({ width: '1em', height: '1em' });
}


function closeModal() {
    DOM.tagManagementModal.classList.remove('visible');
}

export function openTagManagementModal() {
    renderManagedTags();
    DOM.tagManagementModal.classList.add('visible');
    feather.replace({ width: '1em', height: '1em' });
}

export function initTagManagementModalListeners() {
    DOM.closeTagManagementModalBtn.addEventListener('click', closeModal);
    DOM.tagManagementDoneBtn.addEventListener('click', closeModal);
    DOM.tagManagementModal.addEventListener('click', (e) => {
        if (e.target === DOM.tagManagementModal) closeModal();
    });

    // Drag and Drop for merging
    DOM.tagManagementListContainer.addEventListener('dragstart', (e) => {
        const pill = e.target.closest('.managed-tag-pill');
        if (pill && pill.draggable) {
            draggedTagId = parseInt(pill.dataset.tagId, 10);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => pill.classList.add('dragging'), 0);
        }
    });

    DOM.tagManagementListContainer.addEventListener('dragend', (e) => {
        draggedTagId = null;
        e.target.closest('.managed-tag-pill')?.classList.remove('dragging');
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    });

    DOM.tagManagementListContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dropTarget = e.target.closest('.managed-tag-pill');
        if (dropTarget && dropTarget.draggable) {
            const sourcePill = document.querySelector(`.managed-tag-pill[data-tag-id="${draggedTagId}"]`);
            if (sourcePill && dropTarget.dataset.tagId !== sourcePill.dataset.tagId && dropTarget.dataset.categoryId === sourcePill.dataset.categoryId) {
                 e.dataTransfer.dropEffect = 'move';
                 dropTarget.classList.add('drop-target');
            } else {
                e.dataTransfer.dropEffect = 'none';
            }
        }
    });
    
    DOM.tagManagementListContainer.addEventListener('dragleave', (e) => {
        e.target.closest('.managed-tag-pill')?.classList.remove('drop-target');
    });

    DOM.tagManagementListContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropTarget = e.target.closest('.managed-tag-pill');
        if (dropTarget) {
            dropTarget.classList.remove('drop-target');
            const destTagId = parseInt(dropTarget.dataset.tagId, 10);
            if (draggedTagId && destTagId && draggedTagId !== destTagId) {
                handleMerge(draggedTagId, destTagId);
            }
        }
    });
}