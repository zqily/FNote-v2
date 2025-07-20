/**
 * @module Utils
 * Provides common utility functions used across the application.
 */

const ICONS = {};
const iconNamesToCache = [
    'play', 'pause', 'music', 'list', 'globe', 'trash', 'slash', 'search',
    'skip-back', 'skip-forward', 'shuffle', 'repeat', 'bookmark', 'volume-2',
    'minimize-2', 'plus-circle', 'folder', 'youtube', 'arrow-left',
    'arrow-right-circle', 'download', 'plus', 'settings', 'x', 'tag',
    'alert-triangle', 'edit', 'corner-down-right', 'trash-2', 'edit-3',
    'upload', 'archive', 'file-text'
];

/**
 * Pre-renders and caches Feather icons as SVG strings.
 * Must be called after the Feather script has loaded and run once.
 */
export function cacheIcons() {
    if (!window.feather) {
        console.error("Feather icons not loaded. Cannot cache icons.");
        return;
    }
    iconNamesToCache.forEach(name => {
        if (feather.icons[name]) {
            ICONS[name] = feather.icons[name].toSvg({ width: '1em', height: '1em' });
        }
    });
}

/**
 * Sets the inner HTML of an element to a cached Feather icon SVG string,
 * or generates one on-the-fly for non-standard sizes.
 * @param {HTMLElement} element - The element to set the icon on.
 * @param {string} iconName - The name of the Feather icon.
 * @param {object} [attrs={ width: '1em', height: '1em' }] - Optional attributes for the SVG.
 */
export function setIcon(element, iconName, attrs = { width: '1em', height: '1em' }) {
    // Check if we have a cached version with the default size
    if (attrs.width === '1em' && attrs.height === '1em' && ICONS[iconName]) {
        element.innerHTML = ICONS[iconName];
    } else {
        // Generate on the fly for non-standard sizes or uncached icons
        if (window.feather && feather.icons[iconName]) {
            element.innerHTML = feather.icons[iconName].toSvg(attrs);
        } else {
            console.warn(`Icon "${iconName}" not found. Using fallback.`);
            // This fallback is a last resort and should ideally not be hit if icon names are correct.
            element.innerHTML = `<i data-feather="${iconName}"></i>`;
            feather.replace(attrs);
        }
    }
}


/**
 * Creates a debounced function that delays invoking `func` until after `wait` milliseconds have
 * elapsed since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Updates the CSS variable for a range slider's fill progress.
 * @param {HTMLInputElement} slider - The range slider element.
 */
export function updateSliderFill(slider) {
    const percentage = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--progress-percent', `${percentage}%`);
}

/**
 * Formats a duration in seconds into a "mm:ss" string.
 * @param {number} seconds - The duration in seconds.
 * @returns {string} The formatted time string.
 */
export function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Determines which element is directly after the vertical drop position during a drag operation.
 * @param {HTMLElement} container - The container of the draggable elements.
 * @param {number} y - The clientY coordinate of the mouse/drag event.
 * @param {string} selector - The CSS selector for the draggable elements.
 * @param {HTMLElement[] | null} [elementsCache=null] - A pre-queried array of elements to use instead of querying the DOM.
 * @returns {HTMLElement | undefined} The element after the drop position, or undefined.
 */
export function getDragAfterElement(container, y, selector, elementsCache = null) {
    const draggableElements = elementsCache ? elementsCache : [...container.querySelectorAll(selector)];
    const result = draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        // Find the element for which the drop position is just above its midpoint
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY });
    return result.element;
}