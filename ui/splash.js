/**
 * @module ui/splash
 * Manages the UI logic for the application's splash screen.
 */

import * as DOM from '../dom.js';

/**
 * Updates the status text and spinner visibility on the splash screen.
 * @param {string} text - The message to display.
 * @param {boolean} [showSpinner=true] - Whether to show the loading spinner.
 */
export function updateSplashStatus(text, showSpinner = true) {
    DOM.splashStatusText.textContent = text;
    DOM.splashSpinner.classList.toggle('hidden', !showSpinner);
    DOM.splashErrorContainer.classList.add('hidden');
    DOM.splashStatusContainer.classList.remove('hidden');
}

/**
 * Shows an error message on the splash screen.
 * @param {string} message - The error message to display.
 * @param {boolean} [showRetry=true] - Whether to show the retry button.
 */
export function showSplashError(message, showRetry = true) {
    DOM.splashErrorMessage.textContent = message;
    DOM.splashRetryBtn.classList.toggle('hidden', !showRetry);
    DOM.splashStatusContainer.classList.add('hidden');
    DOM.splashErrorContainer.classList.remove('hidden');
}

/**
 * Fades out and hides the splash screen.
 */
export function hideSplashScreen() {
    const splash = DOM.splashScreen;
    if (!splash) return;

    splash.classList.add('fade-out');
    // After the transition, set display to none so it doesn't block interactions.
    splash.addEventListener('transitionend', () => {
        splash.style.display = 'none';
    }, { once: true });
}