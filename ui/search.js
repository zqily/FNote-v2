/**
 * @module ui/search
 * Manages search input and autocomplete functionality.
 */
import * as DOM from '../dom.js';
import * as State from '../state.js';
import * as UI from './index.js';
import * as Api from '../api.js';
import { renderSongList } from './virtualList.js';
import { debounce } from '../utils.js';

let autocompleteActiveIndex = -1;

// Create a debounced version of the song list renderer.
// This prevents excessive API calls while the user is typing.
const debouncedRenderSongList = debounce(renderSongList, 100);

export function hideAutocomplete() {
    DOM.autocompleteResults.classList.add('hidden');
    autocompleteActiveIndex = -1;
}

function applyAutocompleteSelection(selectedValue) {
    const query = DOM.searchInput.value;
    const tagMatch = query.match(/(?:t:|tag:)([\w-]*)$/i);
    if (tagMatch) {
        const prefix = query.substring(0, tagMatch.index);
        const tagSpecifier = tagMatch[0].toLowerCase().startsWith('tag:') ? 'tag:' : 't:';
        const finalValue = selectedValue.includes(' ') ? `'${selectedValue}'` : selectedValue;
        DOM.searchInput.value = `${prefix}${tagSpecifier}${finalValue} `;
    } else {
        DOM.searchInput.value = selectedValue + ' ';
    }
    DOM.searchInput.focus();
    hideAutocomplete();
    debouncedRenderSongList();
    DOM.searchClearBtn.classList.remove('hidden');
}

export function handleAutocompleteNavigation(e) {
    const items = DOM.autocompleteResults.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            autocompleteActiveIndex = (autocompleteActiveIndex + 1) % items.length;
            break;
        case 'ArrowUp':
            e.preventDefault();
            autocompleteActiveIndex = (autocompleteActiveIndex - 1 + items.length) % items.length;
            break;
        case 'Enter':
        case 'Tab':
            if (autocompleteActiveIndex > -1) {
                e.preventDefault();
                applyAutocompleteSelection(items[autocompleteActiveIndex].dataset.value);
            }
            break;
        case 'Escape':
            e.preventDefault();
            hideAutocomplete();
            break;
        default:
            return;
    }
    items.forEach((item, index) => {
        item.classList.toggle('active', index === autocompleteActiveIndex);
        if (index === autocompleteActiveIndex) item.scrollIntoView({ block: 'nearest' });
    });
}

export function handleAutocomplete() {
    const query = DOM.searchInput.value;
    DOM.searchClearBtn.classList.toggle('hidden', query.length === 0);

    // This is now the single source of truth for triggering a search.
    // Autocomplete suggestions (from the backend) are a side-effect of this call.
    debouncedRenderSongList();

    // Local tag completion logic takes precedence over backend suggestions.
    const tagMatch = query.match(/(?:t:|tag:)([\w-]*)$/i);
    if (tagMatch) {
        const tagFragment = tagMatch[1].toLowerCase();
        const allTags = State.getState().tagData?.flatMap(cat => cat.tags.map(t => t.name)) || [];
        const suggestions = allTags.filter(name => name.toLowerCase().startsWith(tagFragment)).slice(0, 10);
        renderAutocomplete(suggestions);
    }
    // No 'else' is needed. If not typing a tag, `renderSongList` will handle showing/hiding
    // the autocomplete based on the backend response.
}

export function renderAutocomplete(suggestions) {
    DOM.autocompleteResults.innerHTML = '';
    if (suggestions.length === 0) {
        hideAutocomplete();
        return;
    }
    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = suggestion;
        item.dataset.value = suggestion;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applyAutocompleteSelection(item.dataset.value);
        });
        DOM.autocompleteResults.appendChild(item);
    });
    DOM.autocompleteResults.classList.remove('hidden');
    autocompleteActiveIndex = -1;
}

/**
 * Appends a selected tag to the search input.
 * @param {string} tagName - The name of the tag to add.
 */
function addTagToSearch(tagName) {
    const currentQuery = DOM.searchInput.value.trim();
    const tagTerm = tagName.includes(' ') ? `t:'${tagName}'` : `t:${tagName}`;
    
    // Add a space if the query isn't empty
    const newQuery = currentQuery ? `${currentQuery} ${tagTerm} ` : `${tagTerm} `;
    
    DOM.searchInput.value = newQuery;
    DOM.searchInput.focus();
    hideTagBuilder();
    handleAutocomplete(); // Trigger re-render of list
}

/**
 * Renders the content of the tag builder popover.
 */
export function renderTagBuilder() {
    const { tagData } = State.getState();
    const container = DOM.tagBuilderContainer;
    container.innerHTML = '';

    if (!tagData || tagData.length === 0) {
        container.innerHTML = '<p class="setting-item-description">No tags have been created yet.</p>';
        return;
    }

    // Get currently active tags from search query to highlight them
    const currentQuery = DOM.searchInput.value.toLowerCase();
    const activeTags = (currentQuery.match(/(?:t:|tag:)(?:'([^']+)'|"([^"]+)"|(\S+))/g) || [])
        .map(match => match.replace(/(t:|tag:|'|")/g, '').trim());


    tagData.forEach(category => {
        const categoryBlock = document.createElement('div');
        categoryBlock.className = 'tag-category-block';

        const categoryTitle = document.createElement('h5');
        categoryTitle.textContent = category.name;
        categoryBlock.appendChild(categoryTitle);

        const pillsContainer = document.createElement('div');
        pillsContainer.className = 'tag-pills-container';
        categoryBlock.appendChild(pillsContainer);

        category.tags.forEach(tag => {
            const pill = document.createElement('span');
            pill.className = 'tag-builder-pill';
            pill.textContent = tag.name;
            pill.dataset.tagName = tag.name;
            
            if (activeTags.includes(tag.name.toLowerCase())) {
                pill.classList.add('selected');
            }

            pill.addEventListener('click', () => {
                addTagToSearch(tag.name);
            });
            pillsContainer.appendChild(pill);
        });
        container.appendChild(categoryBlock);
    });
}

/**
 * Hides the tag builder popover.
 */
export function hideTagBuilder() {
    DOM.tagBuilderPopover.classList.add('hidden');
}

/**
 * Shows the tag builder popover, positioned relative to the trigger button.
 */
export function showTagBuilder() {
    renderTagBuilder(); // Always re-render with fresh data
    UI.positionPopup(DOM.tagBuilderPopover, DOM.tagBuilderBtn, { position: 'below', align: 'left' });
    feather.replace({ width: '1em', height: '1em' });
}