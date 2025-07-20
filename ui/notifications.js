/**
 * @module ui/notifications
 * Manages toast notifications and confirmation dialogs.
 */
import * as DOM from '../dom.js';
import * as State from '../state.js';

let statusClearTimer = null;
let currentGlobalStatusClickHandler = null;

/**
 * Displays a toast notification.
 * @param {string} message - The message to display.
 * @param {'info'|'success'|'error'} [type='info'] - The type of toast.
 * @param {number} [overrideDuration] - An optional duration in seconds to override the user setting. 0 means it persists.
 * @returns {HTMLElement} The created toast element, which can be used for manual dismissal.
 */
export function showToast(message, type = 'info', overrideDuration) {
    if (!DOM.toastContainer) return;

    const durationMs = (overrideDuration ?? State.getState().toastDuration) * 1000;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    if (durationMs > 0) {
        toast.style.setProperty('--toast-duration', `${durationMs / 1000}s`);
    }

    DOM.toastContainer.appendChild(toast);

    const dismiss = () => {
        if (toast.classList.contains('hiding')) return;
        toast.classList.add('hiding');
        // The 'animationend' event will trigger its removal from the DOM
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = durationMs > 0 ? setTimeout(dismiss, durationMs) : null;
    toast.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
    }, { once: true });
    
    return toast;
}

/**
 * Displays a toast notification with action buttons. It does not auto-dismiss.
 * @param {string} message - The message to display.
 * @param {Array<{text: string, class?: string, callback: function}>} buttons - Array of button objects.
 * @returns {HTMLElement} The created toast element.
 */
export function showActionToast(message, buttons = []) {
    if (!DOM.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-info with-actions`;

    const messageEl = document.createElement('span');
    messageEl.textContent = message;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'toast-actions';

    const dismiss = () => {
        if (toast.classList.contains('hiding')) return;
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    buttons.forEach(btnInfo => {
        const button = document.createElement('button');
        button.className = `toast-action-btn ${btnInfo.class || ''}`;
        button.textContent = btnInfo.text;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            btnInfo.callback();
            dismiss();
        });
        actionsEl.appendChild(button);
    });

    toast.append(messageEl, actionsEl);
    DOM.toastContainer.appendChild(toast);

    return toast;
}

/**
 * Shows a promise-based confirmation dialog.
 * @param {string} message - The main prompt message.
 * @param {object} [options] - Configuration for the dialog buttons and title.
 * @returns {Promise<boolean>} A promise that resolves to `true` if confirmed, `false` otherwise.
 */
export function showConfirmation(message, { title = 'Confirmation', okText = 'Confirm', okClass = 'danger', cancelText = 'Cancel' } = {}) {
    return new Promise(resolve => {
        DOM.confirmationTitle.textContent = title;
        DOM.confirmationMessage.textContent = message;
        DOM.confirmOkBtn.textContent = okText;
        DOM.confirmCancelBtn.textContent = cancelText;
        DOM.confirmOkBtn.className = `modal-btn ${okClass || ''}`;
        DOM.confirmationModal.classList.add('visible');
        DOM.confirmOkBtn.focus();

        let onOk, onCancel, onKeydown;

        const cleanup = (value) => {
            DOM.confirmationModal.classList.remove('visible');
            DOM.confirmOkBtn.removeEventListener('click', onOk);
            DOM.confirmCancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
            resolve(value);
        };

        onOk = () => cleanup(true);
        onCancel = () => cleanup(false);

        onKeydown = (e) => {
            if (DOM.confirmationModal.classList.contains('visible')) {
                if (e.key === 'Enter') { e.preventDefault(); onOk(); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }
        };
        
        DOM.confirmOkBtn.addEventListener('click', onOk);
        DOM.confirmCancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);
    });
}


/**
 * Shows a promise-based prompt dialog.
 * @param {string} message - The label for the input field.
 * @param {object} [options] - Configuration for the dialog.
 * @param {string} [options.title='Prompt'] - The title for the dialog.
 * @param {string} [options.defaultValue=''] - The default value for the input field.
 * @param {string} [options.okText='OK'] - The text for the confirm button.
 * @param {string} [options.cancelText='Cancel'] - The text for the cancel button.
 * @param {Function} [options.validator] - A function that takes the input value and returns an error message string if invalid, or a falsy value if valid.
 * @returns {Promise<string|null>} A promise that resolves with the input value if confirmed, or `null` if cancelled.
 */
export function showPrompt(message, { title = 'Prompt', defaultValue = '', okText = 'OK', cancelText = 'Cancel', validator = null } = {}) {
    return new Promise(resolve => {
        DOM.promptTitle.textContent = title;
        DOM.promptMessage.textContent = message;
        DOM.promptMessage.htmlFor = 'prompt-input';
        DOM.promptInput.value = defaultValue;
        DOM.promptOkBtn.textContent = okText;
        DOM.promptCancelBtn.textContent = cancelText;

        DOM.promptError.classList.add('hidden');
        DOM.promptError.textContent = '';
        DOM.promptInput.classList.remove('is-invalid');

        DOM.promptModal.classList.add('visible');
        DOM.promptInput.focus();
        DOM.promptInput.select();

        let onOk, onCancel, onKeydown;

        const cleanup = (value) => {
            DOM.promptModal.classList.remove('visible');
            DOM.promptOkBtn.removeEventListener('click', onOk);
            DOM.promptCancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
            resolve(value);
        };

        onOk = () => {
            const value = DOM.promptInput.value;
            if (validator) {
                const error = validator(value);
                if (error) {
                    DOM.promptError.textContent = error;
                    DOM.promptError.classList.remove('hidden');
                    DOM.promptInput.classList.add('is-invalid');
                    DOM.promptInput.focus();
                    return;
                }
            }
            cleanup(value);
        };

        onCancel = () => cleanup(null);

        onKeydown = (e) => {
            if (DOM.promptModal.classList.contains('visible')) {
                // Reset error state on new input, unless it's a control key
                if (e.key !== 'Enter' && e.key !== 'Escape') {
                    DOM.promptError.classList.add('hidden');
                    DOM.promptInput.classList.remove('is-invalid');
                }
                if (e.key === 'Enter') { e.preventDefault(); onOk(); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }
        };
        
        DOM.promptOkBtn.addEventListener('click', onOk);
        DOM.promptCancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);
    });
}

/**
 * Shows the global status bar.
 * @param {string} message - The message to display.
 * @param {object} [options={}] - Configuration options.
 * @param {boolean} [options.isActive=true] - If true, shows a spinner.
 * @param {boolean} [options.isError=false] - If true, styles the bar as an error.
 * @param {string} [options.summary] - Summary text to show below the main message.
 * @param {Function} [options.onDetailsClick] - A callback to run when the status bar is clicked.
 */
export function showGlobalStatus(message, options = {}) {
    if (!DOM.globalStatus) return;

    const { isActive = true, isError = false, summary = '', onDetailsClick } = options;

    clearTimeout(statusClearTimer);

    // Clean up any existing click handler before setting a new one or none
    if (currentGlobalStatusClickHandler) {
        DOM.globalStatus.removeEventListener('click', currentGlobalStatusClickHandler);
        currentGlobalStatusClickHandler = null;
        DOM.globalStatus.classList.remove('clickable');
    }

    DOM.globalStatusText.textContent = message;
    DOM.globalStatusSummary.textContent = summary;
    DOM.globalStatusSpinner.style.display = isActive ? 'inline-block' : 'none';
    
    DOM.globalStatus.classList.remove('hidden');
    DOM.globalStatus.classList.toggle('is-error', isError);

    // If a click handler is provided, make the entire status bar clickable.
    if (typeof onDetailsClick === 'function') {
        currentGlobalStatusClickHandler = onDetailsClick;
        DOM.globalStatus.addEventListener('click', currentGlobalStatusClickHandler);
        DOM.globalStatus.classList.add('clickable');
    }

    if (!isActive) {
        const duration = isError ? 8000 : 4000;
        statusClearTimer = setTimeout(() => {
            hideGlobalStatus();
        }, duration);
    }
}

/**
 * Hides the global status bar.
 */
export function hideGlobalStatus() {
    if (!DOM.globalStatus) return;
    
    // Also clean up the handler when hiding the bar.
    if (currentGlobalStatusClickHandler) {
        DOM.globalStatus.removeEventListener('click', currentGlobalStatusClickHandler);
        currentGlobalStatusClickHandler = null;
        DOM.globalStatus.classList.remove('clickable');
    }
    DOM.globalStatus.classList.add('hidden');
}