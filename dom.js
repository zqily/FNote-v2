/**
 * @module DOM
 * A single source of truth for all DOM element queries.
 * This centralizes element selection, making the rest of the code cleaner
 * and easier to maintain if the HTML structure changes.
 */

// --- Splash Screen ---
export const splashScreen = document.getElementById('splash-screen');
export const splashStatusContainer = document.querySelector('.splash-status-container');
export const splashStatusText = document.getElementById('splash-status-text');
export const splashSpinner = document.getElementById('splash-spinner');
export const splashErrorContainer = document.getElementById('splash-error-container');
export const splashErrorMessage = document.getElementById('splash-error-message');
export const splashRetryBtn = document.getElementById('splash-retry-btn');

// --- Player Panel ---
export const playerPanel = document.getElementById('player-panel');
export const playPauseBtn = document.getElementById('play-pause-btn');
export const prevBtn = document.getElementById('prev-btn');
export const nextBtn = document.getElementById('next-btn');
export const shuffleBtn = document.getElementById('shuffle-btn');
export const repeatBtn = document.getElementById('repeat-btn');
export const addMarkerBtn = document.getElementById('add-marker-btn');
export const seekBar = document.getElementById('seek-bar');
export const miniPlayerBtn = document.getElementById('mini-player-btn');
export const volumeSlider = document.getElementById('volume-slider');
export const volumeToggleBtn = document.getElementById('volume-toggle-btn');
export const volumeIcon = document.getElementById('volume-icon');
export const currentSongTitle = document.getElementById('current-song-title');
export const currentSongArtist = document.getElementById('current-song-artist');
export const currentTimeEl = document.getElementById('current-time');
export const totalDurationEl = document.getElementById('total-duration');
export const albumArtImg = document.getElementById('album-art-img');
export const albumArtPlaceholder = document.getElementById('album-art-placeholder');
export const eqBars = document.querySelectorAll('.eq-bar');
export const markerContainer = document.getElementById('marker-container');
export const seekBarWrapper = document.querySelector('.seek-bar-wrapper');

// --- Sidebar & Song List ---
export const resizeHandle = document.getElementById('resize-handle');
export const verticalResizeHandle = document.getElementById('vertical-resize-handle');
export const importBtn = document.getElementById('import-btn');
export const searchInput = document.getElementById('search-input');
export const searchInputContainer = document.getElementById('search-input').parentElement;
export const searchModeToggleBtn = document.getElementById('search-mode-toggle');
export const tagBuilderBtn = document.getElementById('tag-builder-btn');
export const tagBuilderPopover = document.getElementById('tag-builder-popover');
export const tagBuilderContainer = document.getElementById('tag-builder-container');
export const autocompleteResults = document.getElementById('autocomplete-results');
export const searchClearBtn = document.getElementById('search-clear-btn');
export const songListEl = document.getElementById('song-list');
export const playlistEmptyState = document.getElementById('playlist-empty-state');
export const queueEmptyState = document.getElementById('queue-empty-state');
export const ffmpegWarning = document.getElementById('ffmpeg-warning');
export const globalStatus = document.getElementById('global-status');
export const globalStatusSpinner = document.getElementById('global-status-spinner');
export const globalStatusText = document.getElementById('global-status-text');
export const globalStatusSummary = document.getElementById('global-status-summary');


// --- Playlist & Queue Section ---
export const playlistList = document.getElementById('playlist-list');
export const activeListTitle = document.getElementById('active-list-title');
export const addPlaylistBtn = document.getElementById('add-playlist-btn');
export const addPlaylistPopover = document.getElementById('add-playlist-popover');
export const createNewPlaylistBtn = document.getElementById('create-new-playlist-btn');
export const importPlaylistBtn = document.getElementById('import-playlist-btn');
export const viewToggleBtn = document.getElementById('view-toggle-btn');
export const clearQueueBtn = document.getElementById('clear-queue-btn');

// --- Import Modal ---
export const importModal = document.getElementById('import-modal');
export const closeModalBtn = document.getElementById('close-modal-btn');
export const modalBackBtn = document.getElementById('modal-back-btn');
export const importModalTitle = document.getElementById('import-modal-title');
export const modalImportFilesBtn = document.getElementById('modal-import-files');
export const modalImportUrlBtn = document.getElementById('modal-import-url');
export const importMethodSection = document.getElementById('import-method-section');
export const urlImportSection = document.getElementById('url-import-section');
export const urlInput = document.getElementById('url-input');
export const fetchUrlBtn = document.getElementById('fetch-url-btn');
export const urlStatus = document.getElementById('url-status');
export const playlistSelectionSection = document.getElementById('playlist-selection-section');
export const playlistSelectionTitle = document.getElementById('playlist-selection-title');
export const selectAllCheckbox = document.getElementById('select-all-checkbox');
export const playlistSelectionGroupsContainer = document.getElementById('playlist-selection-groups-container');
export const downloadSelectedBtn = document.getElementById('download-selected-btn');
export const selectionDownloadStatus = document.getElementById('selection-download-status');

// --- Settings Modal ---
export const settingsBtn = document.getElementById('settings-btn');
export const settingsModal = document.getElementById('settings-modal');
export const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
export const refreshAccentsBtn = document.getElementById('refresh-accents-btn');
export const toastDurationInput = document.getElementById('toast-duration-input');
export const runOnStartupToggle = document.getElementById('run-on-startup-toggle');
export const resumeOnStartupSetting = document.getElementById('resume-on-startup-setting');
export const resumeOnStartupToggle = document.getElementById('resume-on-startup-toggle');
export const registerFileTypeBtn = document.getElementById('register-file-type-btn');
export const manageTagsBtn = document.getElementById('manage-tags-btn');
export const ytdlpVersionSpan = document.getElementById('ytdlp-version');
export const ytdlpUpdateBtn = document.getElementById('ytdlp-update-btn');
export const autoPauseToggle = document.getElementById('auto-pause-toggle');
export const audioBlacklistContainer = document.getElementById('audio-blacklist-container');
export const audioBlacklistInput = document.getElementById('audio-blacklist-input');
export const audioBlacklistAddBtn = document.getElementById('audio-blacklist-add-btn');
export const discordPresenceToggle = document.getElementById('discord-presence-toggle');

// --- Edit Details Modal ---
export const editDetailsModal = document.getElementById('edit-details-modal');
export const closeEditDetailsModalBtn = document.getElementById('close-edit-details-modal-btn');
export const editDetailsCancelBtn = document.getElementById('edit-details-cancel-btn');
export const editDetailsSaveBtn = document.getElementById('edit-details-save-btn');
export const editDetailsSaveToFileToggle = document.getElementById('edit-details-save-to-file-toggle');
export const editDetailsCoverImg = document.getElementById('edit-details-cover-img');
export const editDetailsChangeCoverBtn = document.getElementById('edit-details-change-cover-btn');
export const editDetailsTitleInput = document.getElementById('edit-details-title-input');
export const editDetailsArtistInput = document.getElementById('edit-details-artist-input');
export const editDetailsTagsContainer = document.getElementById('edit-details-tags-container');

// --- Tag Management Modal ---
export const tagManagementModal = document.getElementById('tag-management-modal');
export const closeTagManagementModalBtn = document.getElementById('close-tag-management-modal-btn');
export const tagManagementDoneBtn = document.getElementById('tag-management-done-btn');
export const tagManagementListContainer = document.getElementById('tag-management-list-container');

// --- Progress Modal ---
export const progressModal = document.getElementById('progress-modal');
export const progressModalTitle = document.getElementById('progress-modal-title');
export const progressList = document.getElementById('progress-list');
export const progressModalHideBtn = document.getElementById('progress-modal-hide-btn');

// --- Context Menus & Tooltip ---
export const songContextMenu = document.getElementById('context-menu');
export const editDetailsBtn = document.getElementById('edit-details-btn');
export const playNextBtn = document.getElementById('play-next-btn');
export const addToQueueBtn = document.getElementById('add-to-queue-btn');
export const showInExplorerBtn = document.getElementById('show-in-explorer-btn');
export const deleteBtn = document.getElementById('delete-btn');
export const playlistContextMenu = document.getElementById('playlist-context-menu');
export const playlistRenameBtn = document.getElementById('playlist-rename-btn');
export const playlistExportBtn = document.getElementById('playlist-export-btn');
export const playlistDeleteBtn = document.getElementById('playlist-delete-btn');
export const exportPlaylistPopover = document.getElementById('export-playlist-popover');
export const exportFnlistBtn = document.getElementById('export-fnlist-btn');
export const exportM3uBtn = document.getElementById('export-m3u-btn');
export const songTooltip = document.getElementById('song-tooltip');
export const overrideTooltip = document.getElementById('override-tooltip');
export const importWarningTooltip = document.getElementById('import-warning-tooltip');

// --- Toasts, Confirmation & Prompt Dialogs ---
export const toastContainer = document.getElementById('toast-container');
export const confirmationModal = document.getElementById('confirmation-modal');
export const confirmationTitle = document.getElementById('confirmation-title');
export const confirmationMessage = document.getElementById('confirmation-message');
export const confirmOkBtn = document.getElementById('confirm-ok-btn');
export const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
export const promptModal = document.getElementById('prompt-modal');
export const promptTitle = document.getElementById('prompt-title');
export const promptMessage = document.getElementById('prompt-message');
export const promptInput = document.getElementById('prompt-input');
export const promptError = document.getElementById('prompt-error');
export const promptOkBtn = document.getElementById('prompt-ok-btn');
export const promptCancelBtn = document.getElementById('prompt-cancel-btn');