/**
 * @module modals/progress
 * Manages the logic for the Progress Modal.
 */

import * as DOM from '../dom.js';

function close() {
    DOM.progressModal.classList.remove('visible');
}

/**
 * Initializes the progress modal with content, but does not show it.
 * Visibility is controlled by the global status bar UI.
 * @param {string} title - The title for the modal.
 * @param {Array<{id: string, name: string}>} items - An array of items to track.
 */
function open(title, items) {
    DOM.progressModalTitle.textContent = title;
    DOM.progressList.innerHTML = '';

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'progress-item';
        li.dataset.id = String(item.id).replace(/['"]/g, ''); // Sanitize ID

        const nameSpan = document.createElement('span');
        nameSpan.className = 'progress-item-name';
        nameSpan.textContent = item.name;
        nameSpan.title = item.name;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'progress-item-status';
        statusSpan.textContent = 'Pending';

        const spinner = document.createElement('div');
        spinner.className = 'spinner';

        li.append(nameSpan, statusSpan, spinner);
        DOM.progressList.appendChild(li);
    });

    // The modal is NOT made visible here.
    // The user must click the global status bar to see it.
}

/**
 * Updates a specific item in the progress list.
 * @param {string} id - The ID of the item to update.
 * @param {'working'|'success'|'error'} status - The new status.
 * @param {string} [text] - Optional text to display in the status column.
 */
function update(id, status, text = '') {
    const sanitizedId = String(id).replace(/['"]/g, '');
    const itemEl = DOM.progressList.querySelector(`.progress-item[data-id="${sanitizedId}"]`);
    if (!itemEl) return;

    itemEl.classList.remove('working', 'success', 'error');
    itemEl.classList.add(status);

    const statusEl = itemEl.querySelector('.progress-item-status');
    if (statusEl) {
        switch (status) {
            case 'working':
                statusEl.textContent = text || 'In Progress...';
                break;
            case 'success':
                statusEl.textContent = text || 'Done';
                break;
            case 'error':
                statusEl.textContent = text || 'Failed';
                statusEl.title = text || 'Failed';
                break;
        }
    }
}

function initListeners() {
    DOM.progressModalHideBtn.addEventListener('click', close);
    DOM.progressModal.addEventListener('click', (e) => {
        if (e.target === DOM.progressModal) close();
    });
}

export const Progress = {
    open,
    update,
    close,
    initListeners,
};