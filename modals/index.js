/**
 * @module modals/index
 * Initializes all modal-related event listeners and exports modal-opening functions.
 */

import { initImportModalListeners } from './importModal.js';
import { initSettingsModalListeners } from './settingsModal.js';
import { initEditDetailsModalListeners, openEditDetailsModal as openEdit } from './editDetailsModal.js';
import { initTagManagementModalListeners, openTagManagementModal as openTags } from './tagManagementModal.js';
import { Progress } from './progress.js';

/**
 * Initializes event listeners for all modals.
 */
export function initModalEventListeners() {
    initImportModalListeners();
    initSettingsModalListeners();
    initEditDetailsModalListeners();
    initTagManagementModalListeners();
    Progress.initListeners();
}

/**
 * Opens the Edit Details modal and populates it with a song's data.
 * Re-exported for convenience.
 * @param {object} song - The song object to be edited.
 */
export const openEditDetailsModal = openEdit;

/**
 * Opens the Tag Management modal.
 * Re-exported for convenience.
 */
export const openTagManagementModal = openTags;