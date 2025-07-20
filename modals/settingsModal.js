/**
* @module modals/settingsModal
* Manages the logic for the Settings Modal.
*/

import * as DOM from '../dom.js';
import * as UI from '../ui/index.js';
import * as Api from '../api.js';
import * as State from '../state.js';
import * as Player from '../player.js';
import { openTagManagementModal } from './index.js';

function closeSettingsModal() {
    DOM.settingsModal.classList.remove('visible');
    // Don't reset button state here, as a background process might still be running.
    // Let the completion callback handle it.
}

function renderAudioBlacklist() {
    const { autoPauseAudioProcBlacklist } = State.getState();
    const container = DOM.audioBlacklistContainer;
    container.innerHTML = '';

    const sortedList = [...autoPauseAudioProcBlacklist].sort((a, b) => a.localeCompare(b));

    if (sortedList.length === 0) {
        container.innerHTML = '<p class="setting-item-description" style="text-align: center; padding: 1em;">Blacklist is empty.</p>';
        return;
    }

    sortedList.forEach(processName => {
        const item = document.createElement('div');
        item.className = 'blacklist-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = processName;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-blacklist-item-btn';
        deleteBtn.title = `Remove ${processName}`;
        deleteBtn.innerHTML = `<i data-feather="trash-2"></i>`;
        deleteBtn.addEventListener('click', () => {
            const currentBlacklist = State.getState().autoPauseAudioProcBlacklist;
            const newBlacklist = currentBlacklist.filter(p => p !== processName);
            State.setAutoPauseAudioProcBlacklist(newBlacklist);
            renderAudioBlacklist();
        });

        item.append(nameSpan, deleteBtn);
        container.appendChild(item);
    });

    feather.replace({ width: '0.9em', height: '0.9em' });
}

function handleAddBlacklistItem() {
    const input = DOM.audioBlacklistInput;
    const newProcessName = input.value.trim().toLowerCase();
    
    if (!newProcessName) return;
    
    if (!newProcessName.endsWith('.exe')) {
        UI.showToast('Process name should end with .exe', 'error');
        return;
    }

    const currentBlacklist = State.getState().autoPauseAudioProcBlacklist;

    if (currentBlacklist.map(p => p.toLowerCase()).includes(newProcessName)) {
        UI.showToast(`"${newProcessName}" is already in the blacklist.`, 'info');
        input.value = '';
        return;
    }

    const newBlacklist = [...currentBlacklist, newProcessName];
    State.setAutoPauseAudioProcBlacklist(newBlacklist);
    renderAudioBlacklist();
    input.value = '';
    input.focus();
}

async function checkYtDlpVersion() {
    try {
        const response = await Api.checkYtDlpUpdate();
        DOM.ytdlpVersionSpan.textContent = response.current_version;
        return response;
    } catch(e) {
        DOM.ytdlpVersionSpan.textContent = "Error";
        UI.showToast(`Could not check yt-dlp version: ${e.message}`, 'error');
    }
    return null;
}

export function initSettingsModalListeners() {
    DOM.settingsBtn.addEventListener('click', async () => {
        DOM.settingsModal.classList.add('visible');
        renderAudioBlacklist();
        DOM.ytdlpVersionSpan.textContent = "checking...";
        DOM.ytdlpUpdateBtn.disabled = true;

        // Reset to default tab state when opening
        const tabButtons = DOM.settingsModal.querySelectorAll('.settings-tab-btn');
        const tabPanes = DOM.settingsModal.querySelectorAll('.settings-tab-pane');
        
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabPanes.forEach(pane => pane.classList.remove('active'));
        
        const defaultTab = DOM.settingsModal.querySelector('.settings-tab-btn[data-tab="general"]');
        if (defaultTab) defaultTab.classList.add('active');
        
        const defaultPane = document.getElementById('settings-tab-general');
        if (defaultPane) defaultPane.classList.add('active');
        
        await checkYtDlpVersion();
        DOM.ytdlpUpdateBtn.disabled = false;
    });

    DOM.closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
    DOM.settingsModal.addEventListener('click', (e) => { if (e.target === DOM.settingsModal) closeSettingsModal(); });

    // Add listeners for tab switching
    DOM.settingsModal.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clickedTab = e.currentTarget;
            const targetPaneId = `settings-tab-${clickedTab.dataset.tab}`;
            
            DOM.settingsModal.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            DOM.settingsModal.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.remove('active'));
            
            clickedTab.classList.add('active');
            document.getElementById(targetPaneId)?.classList.add('active');
        });
    });

    DOM.manageTagsBtn.addEventListener('click', () => {
        closeSettingsModal();
        openTagManagementModal();
    });

    DOM.refreshAccentsBtn.addEventListener('click', async () => {
        DOM.refreshAccentsBtn.disabled = true;
        DOM.refreshAccentsBtn.innerHTML = '<span class="spinner"></span> Working...';

        try {
            await Api.refreshAllAccentColors();
            // The process now runs in the background. UI updates will be pushed from Python.
            // We can close the modal now and monitor progress via the global status.
            closeSettingsModal();
        } catch (error) {
            console.error('Failed to start accent color refresh:', error);
            UI.showToast(`Error starting refresh: ${error.message}`, 'error');
            UI.showGlobalStatus(`Failed to start refresh: ${error.message}`, false, true);
            DOM.refreshAccentsBtn.disabled = false;
            DOM.refreshAccentsBtn.textContent = 'Refresh';
        }
    });
    
    DOM.ytdlpUpdateBtn.addEventListener('click', async () => {
        const btn = DOM.ytdlpUpdateBtn;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> Checking...`;
        
        const checkResponse = await checkYtDlpVersion();
        
        if (!checkResponse) {
            btn.textContent = 'Check for Update';
            btn.disabled = false;
            return;
        }

        if (checkResponse.status === 'update_available') {
             const confirmed = await UI.showConfirmation(`A new version of yt-dlp is available (v${checkResponse.latest_version}). Would you like to update?`, { okText: 'Update' });
             if (confirmed) {
                btn.innerHTML = `<span class="spinner"></span> Updating...`;
                try {
                    await Api.updateYtDlp();
                    UI.showToast('yt-dlp updated successfully!', 'success');
                    await checkYtDlpVersion(); // Re-check version after update
                } catch(e) {
                    UI.showToast(`Update failed: ${e.message}`, 'error');
                }
             }
        } else if (checkResponse.status === 'up_to_date') {
            UI.showToast('yt-dlp is already up to date.', 'info');
        }

        btn.textContent = 'Check for Update';
        btn.disabled = false;
    });

    DOM.toastDurationInput.addEventListener('change', e => {
        const input = e.target;
        let newDuration = Number(input.value);
        if (isNaN(newDuration) || newDuration < 0) {
            newDuration = 3; // Reset to default if invalid
            input.value = newDuration;
        }
        State.setToastDuration(newDuration);
        Api.saveToastDuration(newDuration).catch(err => UI.showToast('Failed to save setting.', 'error'));
    });

    DOM.autoPauseToggle?.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        State.setAutoPauseEnabled(isEnabled);
        try {
            const response = await Api.setAutoPauseEnabled(isEnabled);
            UI.showToast(`Auto-pause ${isEnabled ? 'enabled' : 'disabled'}.`, 'info');

            if (response.status === 'warning') {
                UI.showToast(response.message, 'info', 8); // Show warning for 8 seconds
            }

            if (response.status === 'error') {
                UI.showToast(response.message, 'error', 5);
                e.target.checked = false;
                State.setAutoPauseEnabled(false);
            }
            
            if (!isEnabled && State.getState().isExternalAudioActive) {
                State.setWasPlayingBeforeExternalAudio(false);
                State.setIsExternalAudioActive(false);
            }
        } catch (err) {
            UI.showToast(`Failed to save setting: ${err.message}`, 'error');
            e.target.checked = !isEnabled;
            State.setAutoPauseEnabled(!isEnabled);
        }
    });

    DOM.discordPresenceToggle?.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        try {
            const response = await Api.setDiscordPresenceEnabled(isEnabled);
            if (response.status === 'success') {
                // IMPORTANT: Update state only after successful API call
                State.setDiscordPresenceEnabled(isEnabled);
                UI.showToast(`Discord Presence ${isEnabled ? 'enabled' : 'disabled'}.`, 'info');
            } else {
                UI.showToast(`Error: ${response.message}`, 'error');
                e.target.checked = !isEnabled; // Revert toggle on failure
            }
        } catch (err) {
            UI.showToast(`Failed to save setting: ${err.message}`, 'error');
            e.target.checked = !isEnabled; // Revert toggle on failure
        }
    });

    DOM.runOnStartupToggle?.addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        DOM.resumeOnStartupSetting.classList.toggle('hidden', !isEnabled);
        State.setRunOnStartup(isEnabled);
        try {
            const response = await Api.setRunOnStartup(isEnabled);
            if (response.status === 'success') {
                UI.showToast(`Run on startup ${isEnabled ? 'enabled' : 'disabled'}.`, 'info');
            } else {
                UI.showToast(`Error: ${response.message}`, 'error');
                e.target.checked = !isEnabled; // Revert toggle on failure
                DOM.resumeOnStartupSetting.classList.toggle('hidden', isEnabled);
                State.setRunOnStartup(!isEnabled);
            }
        } catch (err) {
            console.error("Failed to set run on startup:", err);
            UI.showToast('An unexpected error occurred.', 'error');
            e.target.checked = !isEnabled;
            DOM.resumeOnStartupSetting.classList.toggle('hidden', isEnabled);
            State.setRunOnStartup(!isEnabled);
        }
    });

    DOM.resumeOnStartupToggle?.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        State.setResumeOnStartup(isEnabled);
        Api.saveResumeOnStartup(isEnabled).catch(err => {
            UI.showToast('Failed to save setting.', 'error');
            e.target.checked = !isEnabled;
            State.setResumeOnStartup(!isEnabled);
        });
    });

    DOM.registerFileTypeBtn?.addEventListener('click', async () => {
        const btn = DOM.registerFileTypeBtn;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> Registering...`;

        try {
            const response = await Api.registerFileType();
            UI.showToast(response.message, 'success');
            btn.textContent = 'Update'; // Provide feedback that it can be run again
        } catch (e) {
            UI.showToast(`Failed to register: ${e.message}`, 'error');
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
    });

    DOM.audioBlacklistAddBtn?.addEventListener('click', handleAddBlacklistItem);
    DOM.audioBlacklistInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddBlacklistItem();
        }
    });
}