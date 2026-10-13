const state = {
  store: 'eva',
  queryByStore: { eva: '', varus: '', makeup: '', aurora: '', notino: '', rozetka: '' },
  products: [],
  brand: '',
  parsing: false,
  suggestions: [],
  cancelRequested: false,
  detailedMode: false,
  variantMode: false,
  sellerMode: false,
  barcodeMode: false,
  comparison: null,
  capture: null,
  batch: { index: 0, total: 0, query: '' },
};

const SAVED_LISTS_STORAGE_KEY = 'price-monitor:saved-brand-lists:v1';
const SEARCH_HISTORY_STORAGE_KEY = 'price-monitor:search-history:v1';

const storeButtons = [...document.querySelectorAll('[data-store]')];
const brandInput = document.getElementById('brand-query');
const brandQueryLabel = document.getElementById('brand-query-label');
const suggestionList = document.getElementById('brand-suggestions');
const parseButton = document.getElementById('parse-products');
const cancelButton = document.getElementById('cancel-products');
const exportButton = document.getElementById('export-excel');
const statusElement = document.getElementById('status');
const statusSpinner = document.getElementById('status-spinner');
const accessBanner = document.getElementById('demo-access-banner');
const accessBannerTitle = document.getElementById('access-banner-title');
const accessSummary = document.getElementById('demo-access-summary');
const accessDetails = document.getElementById('demo-access-details');
const licenseServerActions = document.getElementById('license-server-actions');
const refreshLicenseButton = document.getElementById('refresh-license');
const licenseRefreshStatus = document.getElementById('license-refresh-status');
const licenseActivation = document.getElementById('license-activation');
const onlineActivation = document.getElementById('online-activation');
const activationCodeInput = document.getElementById('activation-code');
const activateLicenseButton = document.getElementById('activate-license');
const exportLicenseRequestButton = document.getElementById('export-license-request');
const importLicenseButton = document.getElementById('import-license');
const licenseActionStatus = document.getElementById('license-action-status');
const checkUpdateButton = document.getElementById('check-update');
const updateNotice = document.getElementById('update-notice');
const updateTitle = document.getElementById('update-title');
const updateNotes = document.getElementById('update-notes');
const installUpdateButton = document.getElementById('install-update');
let availableUpdate = null;
const resultMeta = document.getElementById('result-meta');
const tableBody = document.querySelector('#product-table tbody');
const promoHeaders = [...document.querySelectorAll('.promo-column')];
const variantHeader = document.querySelector('.variant-column');
const sellerHeader = document.querySelector('.seller-column');
const barcodeHeader = document.querySelector('.barcode-column');
const comparisonHeader = document.querySelector('.comparison-column');
const variantsOption = document.getElementById('variants-option');
const variantsCheckbox = document.getElementById('include-variants');
const sellersOption = document.getElementById('sellers-option');
const sellersCheckbox = document.getElementById('include-sellers');
const barcodesOption = document.getElementById('barcodes-option');
const barcodesCheckbox = document.getElementById('include-barcodes');
const savedListSelect = document.getElementById('saved-list-select');
const savedListName = document.getElementById('saved-list-name');
const applySavedListButton = document.getElementById('apply-saved-list');
const runSavedListButton = document.getElementById('run-saved-list');
const duplicateSavedListButton = document.getElementById('duplicate-saved-list');
const renameSavedListButton = document.getElementById('rename-saved-list');
const deleteSavedListButton = document.getElementById('delete-saved-list');
const saveCurrentListButton = document.getElementById('save-current-list');
const exportSavedListsButton = document.getElementById('export-saved-lists');
const importSavedListsButton = document.getElementById('import-saved-lists');
const searchHistoryList = document.getElementById('search-history-list');
const searchHistoryCount = document.getElementById('search-history-count');
const clearSearchHistoryButton = document.getElementById('clear-search-history');
const emptyState = document.getElementById('empty-state');
const tableWrap = document.getElementById('table-wrap');
const resultTools = document.getElementById('result-tools');
const resultFilter = document.getElementById('result-filter');
const clearResultFilterButton = document.getElementById('clear-result-filter');
const resultSort = document.getElementById('result-sort');
const resultChangeFilter = document.getElementById('result-change-filter');
const resultSaleFilter = document.getElementById('result-sale-filter');
const resultMinPrice = document.getElementById('result-min-price');
const resultMaxPrice = document.getElementById('result-max-price');
const copyResultsButton = document.getElementById('copy-results');
const exportVisibleOnlyCheckbox = document.getElementById('export-visible-only');
const resultVisibleCount = document.getElementById('result-visible-count');
const resultSummary = document.getElementById('result-summary');
const summaryTotal = document.getElementById('summary-total');
const summaryDiscounted = document.getElementById('summary-discounted');
const summaryCheapest = document.getElementById('summary-cheapest');
const summaryLargestDiscount = document.getElementById('summary-largest-discount');
const noFilterResults = document.getElementById('no-filter-results');
const comparisonSummary = document.getElementById('comparison-summary');
const comparisonTitle = document.getElementById('comparison-title');
const comparisonCaption = document.getElementById('comparison-caption');
const comparisonCounts = document.getElementById('comparison-counts');
const missingProducts = document.getElementById('missing-products');
const missingProductsTitle = document.getElementById('missing-products-title');
const missingProductsList = document.getElementById('missing-products-list');
const showCapabilitiesButton = document.getElementById('show-capabilities');
const capabilitiesDialog = document.getElementById('capabilities-dialog');
const showGuideButton = document.getElementById('show-guide');
const guideDialog = document.getElementById('guide-dialog');
const guideSearch = document.getElementById('guide-search');
const guideClearSearch = document.getElementById('guide-clear-search');
const guideFilterCount = document.getElementById('guide-filter-count');
const guideNav = document.getElementById('guide-nav');
const guideSections = document.getElementById('guide-sections');
const guideEmpty = document.getElementById('guide-empty');
const guideSectionElements = [...document.querySelectorAll('[data-guide-section]')];
const showArchiveButton = document.getElementById('show-archive');
const archiveDialog = document.getElementById('archive-dialog');
const archiveStoreFilter = document.getElementById('archive-store-filter');
const archiveQueryFilter = document.getElementById('archive-query-filter');
const archiveDateFrom = document.getElementById('archive-date-from');
const archiveDateTo = document.getElementById('archive-date-to');
const archiveClearFilters = document.getElementById('archive-clear-filters');
const archiveFilterSummary = document.getElementById('archive-filter-summary');
const archiveFilteredExportHint = document.getElementById('archive-filter-export-hint');
const archiveFilteredExportStatus = document.getElementById('archive-filter-export-status');
const archiveFilteredExportButton = document.getElementById('archive-filter-export-button');
const archiveFilteredDeleteButton = document.getElementById('archive-filter-delete-button');
const archiveDeleteStatus = document.getElementById('archive-delete-status');
const archiveDeleteUndoButton = document.getElementById('archive-delete-undo');
const archiveList = document.getElementById('archive-list');
const archiveCompareBase = document.getElementById('archive-compare-base');
const archiveCompareCurrent = document.getElementById('archive-compare-current');
const archiveCompareButton = document.getElementById('archive-compare');
const archiveCompareHint = document.getElementById('archive-compare-hint');
const combinedExportPanel = document.getElementById('combined-export-panel');
const combinedExportStores = document.getElementById('combined-export-stores');
const combinedExportHint = document.getElementById('combined-export-hint');
const combinedExportStatus = document.getElementById('combined-export-status');
const combinedExportButton = document.getElementById('combined-export-button');
const captureNotice = document.getElementById('capture-notice');
const priceHistoryDialog = document.getElementById('price-history-dialog');
const priceHistoryTitle = document.getElementById('price-history-title');
const priceHistoryContext = document.getElementById('price-history-context');
const priceHistoryStats = document.getElementById('price-history-stats');
const priceHistoryChart = document.getElementById('price-history-chart');
const priceHistoryRows = document.getElementById('price-history-rows');
const priceHistoryTableWrap = document.querySelector('.price-history-table-wrap');
const exportPriceHistoryButton = document.getElementById('export-price-history');
const priceHistoryExportStatus = document.getElementById('price-history-export-status');
const showChangeReportButton = document.getElementById('show-change-report');
const changeReportDialog = document.getElementById('change-report-dialog');
const changeReportDateFrom = document.getElementById('change-report-date-from');
const changeReportDateTo = document.getElementById('change-report-date-to');
const changeReportApplyPeriod = document.getElementById('change-report-apply-period');
const changeReportAllTime = document.getElementById('change-report-all-time');
const changeReportPeriodStatus = document.getElementById('change-report-period-status');
const changeReportPresetButtons = [...document.querySelectorAll('[data-change-report-days]')];
const changeReportStores = document.getElementById('change-report-stores');
const changeReportStoreFilter = document.getElementById('change-report-store-filter');
const changeReportStatusFilter = document.getElementById('change-report-status-filter');
const changeReportTextFilter = document.getElementById('change-report-text-filter');
const changeReportCount = document.getElementById('change-report-count');
const changeReportRows = document.getElementById('change-report-rows');
const changeReportExportStatus = document.getElementById('change-report-export-status');
const exportChangeReportButton = document.getElementById('export-change-report');
const parserApi = window.priceParser;
const batchUtils = window.priceMonitorBatch;
const savedListUtils = window.priceMonitorSavedLists;
const searchHistoryUtils = window.priceMonitorSearchHistory;
const resultViewUtils = window.priceMonitorResultView;
const comparisonUtils = window.priceMonitorComparison;
const archiveTools = window.priceMonitorArchiveTools;
const parserAvailable = Boolean(parserApi?.parseBrand && parserApi?.exportExcel && batchUtils?.runBrandBatch);
const savedListsAvailable = Boolean(savedListUtils?.parseSavedLists && savedListUtils?.upsertSavedList);
const searchHistoryAvailable = Boolean(searchHistoryUtils?.parseSearchHistory && searchHistoryUtils?.addSearchHistory);
const comparisonAvailable = Boolean(
  comparisonUtils?.createSnapshotKey
  && comparisonUtils?.compareWithSnapshot
  && parserApi?.getComparisonSnapshot
  && parserApi?.saveComparisonSnapshot,
);

let suggestionTimer = null;
let suggestionRequest = 0;
let pendingStore = null;
let savedLists = readSavedLists();
let searchHistory = readSearchHistory();
let archiveSummaries = [];
let filteredArchiveSummaries = [];
let priceHistoryRequest = 0;
let priceHistorySelection = null;
let archiveActionBusy = false;
let archiveDeleteUndoToken = '';
let changeOverview = null;
let changeReportBusy = false;
let accessStatus = { isDemo: false, isLicensed: false, allowed: true };

storeButtons.forEach((button) => {
  button.addEventListener('click', () => selectStore(button.dataset.store));
});

brandInput.addEventListener('input', () => {
  state.queryByStore[state.store] = brandInput.value;
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(loadSuggestions, 220);
});

brandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    hideSuggestions();
    startParsing();
  }
  if (event.key === 'Escape') hideSuggestions();
});

brandInput.addEventListener('focus', () => {
  if (state.suggestions.length) renderSuggestions();
});

brandInput.addEventListener('paste', (event) => {
  const pasted = event.clipboardData?.getData('text') || '';
  if (!/[\r\n]/.test(pasted)) return;
  event.preventDefault();
  const replacement = batchUtils.normalizePastedBrands(pasted);
  brandInput.setRangeText(
    replacement,
    brandInput.selectionStart ?? brandInput.value.length,
    brandInput.selectionEnd ?? brandInput.value.length,
    'end',
  );
  brandInput.dispatchEvent(new Event('input', { bubbles: true }));
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-field')) hideSuggestions();
});

parseButton.addEventListener('click', startParsing);
refreshLicenseButton.addEventListener('click', refreshLicenseNow);
activateLicenseButton.addEventListener('click', activateLicense);
exportLicenseRequestButton.addEventListener('click', exportLicenseRequest);
importLicenseButton.addEventListener('click', importLicenseFile);
checkUpdateButton.addEventListener('click', checkForUpdateNow);
installUpdateButton.addEventListener('click', installAvailableUpdate);
activationCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') activateLicense();
});
cancelButton.addEventListener('click', async () => {
  if (!parserAvailable) return showLaunchHint();
  state.cancelRequested = true;
  cancelButton.disabled = true;
  setStatus('Зупиняю пошук…', 'loading');
  await parserApi.cancel();
});
exportButton.addEventListener('click', exportExcel);
savedListSelect.addEventListener('change', updateSavedListButtons);
applySavedListButton.addEventListener('click', applySavedList);
runSavedListButton.addEventListener('click', runSavedList);
duplicateSavedListButton.addEventListener('click', duplicateSavedList);
renameSavedListButton.addEventListener('click', renameSavedList);
deleteSavedListButton.addEventListener('click', deleteSavedList);
saveCurrentListButton.addEventListener('click', saveCurrentList);
exportSavedListsButton.addEventListener('click', exportSavedLists);
importSavedListsButton.addEventListener('click', importSavedLists);
clearSearchHistoryButton.addEventListener('click', clearStoreSearchHistory);
showGuideButton.addEventListener('click', openGuide);
guideSearch.addEventListener('input', filterGuideSections);
guideClearSearch.addEventListener('click', () => {
  guideSearch.value = '';
  filterGuideSections();
  guideSearch.focus();
});
guideNav.addEventListener('click', navigateGuide);
showCapabilitiesButton.addEventListener('click', () => capabilitiesDialog.showModal());
showArchiveButton.addEventListener('click', openArchiveDialog);
showChangeReportButton.addEventListener('click', openChangeReport);
changeReportApplyPeriod.addEventListener('click', applyChangeReportPeriod);
changeReportAllTime.addEventListener('click', showAllTimeChangeReport);
changeReportPresetButtons.forEach((button) => button.addEventListener('click', () => applyChangeReportPreset(Number(button.dataset.changeReportDays))));
changeReportDateFrom.addEventListener('change', markChangeReportPeriodPending);
changeReportDateTo.addEventListener('change', markChangeReportPeriodPending);
archiveStoreFilter.addEventListener('change', refreshArchiveFilters);
archiveQueryFilter.addEventListener('input', refreshArchiveFilters);
archiveDateFrom.addEventListener('change', refreshArchiveFilters);
archiveDateTo.addEventListener('change', refreshArchiveFilters);
archiveClearFilters.addEventListener('click', () => {
  archiveStoreFilter.value = 'all';
  archiveQueryFilter.value = '';
  archiveDateFrom.value = '';
  archiveDateTo.value = '';
  refreshArchiveFilters();
});
archiveFilteredExportButton.addEventListener('click', exportFilteredArchives);
archiveFilteredDeleteButton.addEventListener('click', deleteFilteredArchives);
archiveDeleteUndoButton.addEventListener('click', restoreDeletedArchives);
archiveCompareBase.addEventListener('change', updateArchiveCompareTargets);
archiveCompareCurrent.addEventListener('change', () => { archiveCompareButton.disabled = archiveActionBusy || !archiveCompareCurrent.value; });
archiveCompareButton.addEventListener('click', compareSelectedArchives);
combinedExportStores.addEventListener('change', updateCombinedExportState);
combinedExportButton.addEventListener('click', exportCombinedArchives);
exportPriceHistoryButton.addEventListener('click', exportPriceHistory);
changeReportStoreFilter.addEventListener('change', renderChangeReportRows);
changeReportStatusFilter.addEventListener('change', renderChangeReportRows);
changeReportTextFilter.addEventListener('input', renderChangeReportRows);
exportChangeReportButton.addEventListener('click', exportChangeReport);
resultFilter.addEventListener('input', renderProducts);
resultSort.addEventListener('change', renderProducts);
resultChangeFilter.addEventListener('change', renderProducts);
resultSaleFilter.addEventListener('change', renderProducts);
resultMinPrice.addEventListener('input', renderProducts);
resultMaxPrice.addEventListener('input', renderProducts);
copyResultsButton.addEventListener('click', copyVisibleResults);
exportVisibleOnlyCheckbox.addEventListener('change', () => updateResultExportState(getVisibleProducts().length));
clearResultFilterButton.addEventListener('click', () => {
  resultFilter.value = '';
  renderProducts();
  resultFilter.focus();
});
savedListName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveCurrentList();
  }
});

renderSavedLists();
renderSearchHistory();

if (parserAvailable) {
  parserApi.onProgress((progress) => {
    if (!state.parsing || pendingStore || progress.store !== state.store) return;
    const prefix = state.batch.total > 1
      ? `Запит ${state.batch.index + 1} із ${state.batch.total} · `
      : '';
    setStatus(
      `${prefix}${progress.message || 'Триває завантаження…'}`,
      progress.phase === 'error' ? 'error' : 'loading',
    );
  });
  setStatus('Введіть одну або кілька торгових марок', 'idle');
  initializeAccess().catch(() => {});
  parserApi.onAccessChanged?.((status) => updateAccessUi(status));
  parserApi.onUpdateAvailable?.((update) => showAvailableUpdate(update));
  restoreRecovery().catch(() => {});
} else {
  showLaunchHint();
}

async function initializeAccess() {
  if (typeof parserApi?.getAccessStatus !== 'function') return;
  const status = await parserApi.getAccessStatus();
  updateAccessUi(status);
}

function updateAccessUi(status) {
  accessStatus = status && typeof status === 'object'
    ? status
    : { isDemo: false, isLicensed: false, allowed: true };
  updateLicensedStoreVisibility();
  if (!accessStatus.isDemo && !accessStatus.isLicensed) {
    accessBanner.hidden = true;
    licenseServerActions.hidden = true;
    licenseActivation.hidden = true;
    return;
  }

  accessBanner.hidden = false;
  accessBanner.classList.toggle('is-licensed', Boolean(accessStatus.isLicensed));
  accessBanner.classList.toggle('is-blocked', !accessStatus.allowed);
  if (accessStatus.isLicensed) {
    licenseServerActions.hidden = !accessStatus.onlineConfigured;
    document.title = 'Price Monitor Licensed';
    accessBannerTitle.textContent = 'Ліцензійна версія';
    accessSummary.textContent = accessStatus.allowed
      ? `Оплачено до ${formatLicenseDate(accessStatus.paidUntil || accessStatus.expiresAt)}`
      : licensedBlockedSummary(accessStatus.blockedReason);
    accessDetails.textContent = accessStatus.allowed
      ? `${accessStatus.customerName || 'Тестова ліцензія'} · пристрій ${accessStatus.deviceCode || 'не визначено'} · ${accessStatus.onlineConfigured ? `автономний допуск до ${formatLicenseDate(accessStatus.leaseExpiresAt || accessStatus.expiresAt)}` : 'працює за офлайн-ліцензією'}`
      : accessStatus.blockedReason === 'device_mismatch'
        ? `Ця ліцензія видана для іншого комп’ютера. Код пристрою: ${accessStatus.deviceCode || 'не вдалося визначити'}.`
        : `Нові пошуки заблоковано. Код пристрою: ${accessStatus.deviceCode || 'не вдалося визначити'}.`;
    licenseActivation.hidden = accessStatus.allowed;
    onlineActivation.hidden = !accessStatus.onlineConfigured;
    if (accessStatus.allowed) licenseActionStatus.textContent = '';
  } else if (accessStatus.allowed) {
    licenseServerActions.hidden = true;
    licenseActivation.hidden = true;
    document.title = 'Price Monitor Demo';
    accessBannerTitle.textContent = 'Демонстраційна версія';
    accessSummary.textContent = `Залишилося ${accessStatus.daysRemaining} ${ukPlural(accessStatus.daysRemaining, 'день', 'дні', 'днів')} · ${accessStatus.searchesRemaining} ${ukPlural(accessStatus.searchesRemaining, 'пошук', 'пошуки', 'пошуків')}`;
    accessDetails.textContent = `До ${accessStatus.maxBrands} марок і до ${accessStatus.maxResults} рядків в одному пошуку.`;
  } else {
    licenseServerActions.hidden = true;
    licenseActivation.hidden = true;
    document.title = 'Price Monitor Demo';
    accessBannerTitle.textContent = 'Демонстраційна версія';
    accessSummary.textContent = accessStatus.blockedReason === 'time_expired'
      ? 'Термін демо завершився'
      : accessStatus.blockedReason === 'search_limit'
        ? 'Використано всі демонстраційні пошуки'
        : 'Не вдалося перевірити демонстраційний доступ';
    accessDetails.textContent = 'Нові пошуки заблоковано. Збережені результати та експорт в Excel залишаються доступними.';
  }
  parseButton.disabled = state.parsing || !accessStatus.allowed;
  updateSavedListButtons();
  renderSearchHistory();
}

async function refreshLicenseNow() {
  refreshLicenseButton.disabled = true;
  licenseRefreshStatus.textContent = 'Перевіряю сервер…';
  try {
    const result = await parserApi.refreshAccess();
    if (result?.status) updateAccessUi(result.status);
    licenseRefreshStatus.textContent = result?.updated
      ? 'Ліцензію та набір магазинів оновлено.'
      : result?.reason === 'server_unavailable'
        ? 'Сервер недоступний. Чинний автономний допуск збережено.'
        : result?.checked
          ? licenseActionError(result.reason)
          : 'Онлайн-перевірка недоступна.';
  } catch (_error) {
    licenseRefreshStatus.textContent = 'Не вдалося зв’язатися із сервером.';
  } finally {
    refreshLicenseButton.disabled = false;
  }
}

async function activateLicense() {
  const activationCode = activationCodeInput.value.trim();
  if (!activationCode) {
    licenseActionStatus.textContent = 'Введіть код активації.';
    return;
  }
  setLicenseActionsBusy(true);
  licenseActionStatus.textContent = 'Перевіряю код…';
  try {
    const result = await parserApi.activateLicense(activationCode);
    updateAccessUi(result.status);
    if (result.updated) {
      activationCodeInput.value = '';
      licenseActionStatus.textContent = 'Ліцензію активовано.';
    } else {
      licenseActionStatus.textContent = licenseActionError(result.reason);
    }
  } catch (_error) {
    licenseActionStatus.textContent = 'Не вдалося зв’язатися із сервером ліцензій.';
  } finally {
    setLicenseActionsBusy(false);
  }
}

async function exportLicenseRequest() {
  setLicenseActionsBusy(true);
  licenseActionStatus.textContent = 'Готую запит…';
  try {
    const result = await parserApi.exportLicenseRequest();
    licenseActionStatus.textContent = result.saved
      ? 'Запит збережено. Надішліть цей JSON-файл власнику програми.'
      : result.canceled ? '' : 'Не вдалося зберегти запит.';
  } catch (_error) {
    licenseActionStatus.textContent = 'Не вдалося сформувати запит на ліцензію.';
  } finally {
    setLicenseActionsBusy(false);
  }
}

async function importLicenseFile() {
  setLicenseActionsBusy(true);
  licenseActionStatus.textContent = 'Перевіряю файл…';
  try {
    const result = await parserApi.importLicense();
    updateAccessUi(result.status);
    licenseActionStatus.textContent = result.updated
      ? 'Ліцензію встановлено.'
      : result.canceled ? '' : licenseActionError(result.reason);
  } catch (_error) {
    licenseActionStatus.textContent = 'Не вдалося встановити файл ліцензії.';
  } finally {
    setLicenseActionsBusy(false);
  }
}

function setLicenseActionsBusy(value) {
  activateLicenseButton.disabled = value;
  exportLicenseRequestButton.disabled = value;
  importLicenseButton.disabled = value;
  activationCodeInput.disabled = value;
}

function licenseActionError(reason) {
  return {
    activation_code_invalid: 'Код активації неправильний або вже недійсний.',
    device_limit: 'Використано всі дозволені комп’ютери. Власник ліцензії може відв’язати старий пристрій.',
    device_blocked: 'Цей комп’ютер заблоковано власником ліцензії.',
    device_mismatch: 'Файл ліцензії створено для іншого комп’ютера.',
    payment_required: 'Оплачений період завершився.',
    license_blocked: 'Ліцензію заблоковано.',
    pending_approval: 'Запит отримано. Цей комп’ютер очікує підтвердження власником.',
    suspended: 'Ліцензію тимчасово призупинено власником.',
    time_expired: 'Термін дії цього файла ліцензії завершився.',
    revoked: 'Ліцензію відкликано.',
    signature_invalid: 'Підпис файла ліцензії неправильний.',
    not_configured: 'Онлайн-активацію ще не підключено. Збережіть запит або встановіть файл ліцензії.',
    server_unavailable: 'Сервер ліцензій тимчасово недоступний.',
  }[reason] || 'Не вдалося підтвердити ліцензію.';
}

async function checkForUpdateNow() {
  checkUpdateButton.disabled = true;
  licenseRefreshStatus.textContent = 'Перевіряю оновлення…';
  try {
    const result = await parserApi.checkForUpdate();
    if (result?.update) {
      showAvailableUpdate(result.update);
      licenseRefreshStatus.textContent = `Доступна версія ${result.update.payload.version}.`;
    } else {
      updateNotice.hidden = true;
      availableUpdate = null;
      licenseRefreshStatus.textContent = result?.reason ? licenseActionError(result.reason) : 'Встановлено актуальну версію.';
    }
  } catch (_error) {
    licenseRefreshStatus.textContent = 'Не вдалося перевірити оновлення.';
  } finally {
    checkUpdateButton.disabled = false;
  }
}

function showAvailableUpdate(update) {
  if (!update?.payload) return;
  availableUpdate = update;
  updateNotice.hidden = false;
  updateTitle.textContent = `Доступне оновлення ${update.payload.version}${update.payload.required ? ' · обов’язкове' : ''}`;
  updateNotes.textContent = update.payload.notes || 'Нова версія готова до встановлення.';
}

async function installAvailableUpdate() {
  if (!availableUpdate?.payload?.releaseId) return;
  installUpdateButton.disabled = true;
  installUpdateButton.textContent = 'Завантажую…';
  const result = await parserApi.installUpdate(availableUpdate.payload.releaseId).catch(() => ({ started: false }));
  installUpdateButton.textContent = result.started ? 'Інсталятор запущено' : 'Повторити завантаження';
  installUpdateButton.disabled = Boolean(result.started);
}

function accessDeniedMessage(reason, status = accessStatus) {
  if (status?.isLicensed) {
    if (reason === 'store_not_allowed') return 'Цей магазин не входить до поточної ліцензії.';
    if (reason === 'time_expired') return 'Термін ліцензії завершився. Продовжіть її, щоб запустити новий пошук.';
    if (reason === 'clock_rollback') return 'Перевірте правильність дати й часу на комп’ютері.';
    if (reason === 'pending_approval') return 'Запит на активацію вже отримано. Дочекайтеся підтвердження власника.';
    if (reason === 'suspended') return 'Ліцензію тимчасово призупинено власником.';
    if (reason === 'revoked') return 'Ліцензію відкликано. Зверніться до власника програми.';
    if (reason === 'device_mismatch') return `Ліцензію видано для іншого комп’ютера. Код цього пристрою: ${status?.deviceCode || 'не визначено'}.`;
    if (reason === 'device_id_unavailable') return 'Не вдалося визначити цей комп’ютер для перевірки ліцензії.';
    return 'Файл ліцензії відсутній або пошкоджений. Зверніться до власника програми.';
  }
  if (reason === 'brand_limit') {
    return `У демо-версії можна перевірити не більше ${status?.maxBrands || 3} марок за один пошук.`;
  }
  if (reason === 'time_expired') return 'Термін демонстраційної версії завершився. Нові пошуки недоступні.';
  if (reason === 'search_limit') return 'Використано всі демонстраційні пошуки.';
  return 'Не вдалося перевірити демонстраційний доступ. Перезапустіть програму або зверніться до автора.';
}

function updateLicensedStoreVisibility() {
  const restricted = Boolean(accessStatus.isLicensed && Array.isArray(accessStatus.stores) && accessStatus.stores.length);
  const allowedStores = new Set(restricted ? accessStatus.stores : storeButtons.map((button) => button.dataset.store));
  storeButtons.forEach((button) => {
    button.hidden = !allowedStores.has(button.dataset.store);
  });
  if (restricted && !allowedStores.has(state.store) && !state.parsing) {
    const firstAllowed = storeButtons.find((button) => allowedStores.has(button.dataset.store));
    if (firstAllowed) applyStore(firstAllowed.dataset.store);
  }
}

function isAccessBlocked() {
  return Boolean((accessStatus.isDemo || accessStatus.isLicensed) && !accessStatus.allowed);
}

function formatLicenseDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'невідомої дати';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
  }).format(date);
}

function licensedBlockedSummary(reason) {
  if (reason === 'pending_approval') return 'Очікує підтвердження власником';
  if (reason === 'suspended') return 'Ліцензію тимчасово призупинено';
  if (reason === 'time_expired') return 'Термін ліцензії завершився';
  if (reason === 'clock_rollback') return 'Не вдалося підтвердити системну дату';
  if (reason === 'revoked') return 'Ліцензію відкликано';
  if (reason === 'device_mismatch') return 'Ліцензія іншого комп’ютера';
  if (reason === 'device_id_unavailable') return 'Не вдалося визначити пристрій';
  if (reason === 'license_missing') return 'Файл ліцензії не знайдено';
  return 'Ліцензія пошкоджена або недійсна';
}

function openGuide() {
  guideSearch.value = '';
  filterGuideSections();
  guideSections.scrollTop = 0;
  guideDialog.showModal();
  guideSearch.focus();
}

function normalizeGuideText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('uk');
}

function filterGuideSections() {
  const tokens = normalizeGuideText(guideSearch.value).split(/\s+/).filter(Boolean);
  let visibleCount = 0;

  guideSectionElements.forEach((section) => {
    const matches = tokens.every((token) => normalizeGuideText(section.textContent).includes(token));
    section.hidden = !matches;
    const navButton = guideNav.querySelector(`[data-guide-target="${section.id}"]`);
    if (navButton) {
      navButton.hidden = !matches;
      if (!matches) navButton.removeAttribute('aria-current');
    }
    if (matches) visibleCount += 1;
  });

  guideEmpty.hidden = visibleCount > 0;
  guideFilterCount.textContent = tokens.length
    ? `Знайдено ${visibleCount} із ${guideSectionElements.length} розділів.`
    : `Усі ${guideSectionElements.length} розділів інструкції.`;
}

function navigateGuide(event) {
  const button = event.target.closest('[data-guide-target]');
  if (!button || button.hidden) return;

  guideNav.querySelectorAll('[data-guide-target]').forEach((item) => item.removeAttribute('aria-current'));
  button.setAttribute('aria-current', 'true');
  const target = document.getElementById(button.dataset.guideTarget);
  if (target && !target.hidden) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectStore(store) {
  if (store === state.store) return;
  if (state.parsing) {
    pendingStore = store;
    state.cancelRequested = true;
    setStatus('Зупиняю поточний пошук і перемикаю магазин…', 'loading');
    parserApi?.cancel?.().catch(() => {});
    return;
  }

  applyStore(store);
}

function applyStore(store) {
  state.queryByStore[state.store] = brandInput.value;
  state.store = store;
  brandInput.value = state.queryByStore[store] || '';
  brandQueryLabel.textContent = store === 'makeup' ? 'Торгові марки або штрихкод' : 'Торгові марки';
  brandInput.placeholder = store === 'varus'
    ? "Наприклад: Lay's, Coca-Cola, Jacobs"
    : store === 'aurora'
      ? 'Наприклад: Lovit, YES, Jovial Luxe'
      : store === 'notino'
      ? 'Наприклад: Maybelline, Nivea, Dior'
      : store === 'makeup'
        ? 'Наприклад: Maybelline, Nivea або 3600531609764'
      : store === 'rozetka'
          ? 'Наприклад: Maybelline, Nivea, L’Oreal Paris'
      : "Наприклад: Nivea, Dove, L'Oreal Paris";

  storeButtons.forEach((button) => {
    const active = button.dataset.store === store;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  variantsOption.hidden = !['eva', 'makeup', 'notino', 'aurora'].includes(store);
  sellersOption.hidden = store !== 'rozetka';
  barcodesOption.hidden = store !== 'makeup';
  renderSavedLists();
  renderSearchHistory();

  clearResults();
  hideSuggestions();
  setStatus(store === 'makeup'
    ? 'Введіть торгову марку, список марок або штрихкод'
    : 'Введіть одну або кілька торгових марок', 'idle');
  brandInput.focus();
}

async function loadSuggestions() {
  const query = batchUtils.activeBrandSegment(brandInput.value);
  const store = state.store;
  if (!query || state.parsing || looksLikeBarcodeInput(query)) {
    hideSuggestions();
    return;
  }

  const requestId = ++suggestionRequest;
  try {
    const suggestions = await parserApi.suggestBrands(store, query);
    if (requestId !== suggestionRequest || store !== state.store) return;
    state.suggestions = suggestions;
    renderSuggestions();
  } catch (_error) {
    hideSuggestions();
  }
}

function renderSuggestions() {
  suggestionList.replaceChildren();
  if (!state.suggestions.length) {
    hideSuggestions();
    return;
  }

  state.suggestions.forEach((suggestion) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.textContent = suggestion.name;
    button.addEventListener('click', () => {
      brandInput.value = batchUtils.replaceActiveBrandSegment(brandInput.value, suggestion.name);
      state.queryByStore[state.store] = brandInput.value;
      hideSuggestions();
      brandInput.focus();
    });
    suggestionList.appendChild(button);
  });
  suggestionList.hidden = false;
}

function hideSuggestions() {
  suggestionList.hidden = true;
  suggestionList.replaceChildren();
}

function readSavedLists() {
  if (!savedListsAvailable) return [];
  try {
    return savedListUtils.parseSavedLists(localStorage.getItem(SAVED_LISTS_STORAGE_KEY));
  } catch (_error) {
    return [];
  }
}

function writeSavedLists() {
  try {
    localStorage.setItem(SAVED_LISTS_STORAGE_KEY, JSON.stringify(savedLists));
    return true;
  } catch (_error) {
    return false;
  }
}

function renderSavedLists(selectedId = '') {
  const items = savedListsAvailable ? savedListUtils.listsForStore(savedLists, state.store) : [];
  savedListSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = items.length
    ? 'Оберіть список для цього магазину'
    : 'Для цього магазину списків ще немає';
  savedListSelect.appendChild(placeholder);
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name} · ${batchUtils.splitBrandQueries(item.query).length}`;
    savedListSelect.appendChild(option);
  });
  savedListSelect.value = items.some((item) => item.id === selectedId) ? selectedId : '';
  updateSavedListButtons();
}

function updateSavedListButtons() {
  const hasSelection = Boolean(savedListSelect.value);
  applySavedListButton.disabled = state.parsing || !hasSelection;
  runSavedListButton.disabled = state.parsing || !hasSelection || isAccessBlocked();
  duplicateSavedListButton.disabled = state.parsing || !hasSelection;
  renameSavedListButton.disabled = state.parsing || !hasSelection;
  deleteSavedListButton.disabled = state.parsing || !hasSelection;
  exportSavedListsButton.disabled = state.parsing;
  importSavedListsButton.disabled = state.parsing;
}

function saveCurrentList() {
  if (state.parsing || !savedListsAvailable) return;
  const name = savedListName.value.trim();
  const query = brandInput.value.trim();
  if (!name) {
    setStatus('Введіть назву списку.', 'error');
    savedListName.focus();
    return;
  }
  if (!batchUtils.splitBrandQueries(query).length) {
    setStatus('Спочатку введіть марки або штрихкод у поле пошуку.', 'error');
    brandInput.focus();
    return;
  }

  const options = {
    includeVariants: ['eva', 'makeup', 'notino', 'aurora'].includes(state.store)
      && variantsCheckbox.checked,
    includeSellers: state.store === 'rozetka' && sellersCheckbox.checked,
    includeBarcodes: state.store === 'makeup' && barcodesCheckbox.checked,
  };
  const result = savedListUtils.upsertSavedList(savedLists, {
    store: state.store,
    name,
    query,
    options,
  });
  if (!result.item) return;
  savedLists = result.lists;
  if (!writeSavedLists()) {
    setStatus('Не вдалося зберегти список на цьому комп’ютері.', 'error');
    return;
  }
  renderSavedLists(result.item.id);
  savedListName.value = result.item.name;
  setStatus(`Список «${result.item.name}» збережено.`, 'success');
}

function applySavedList() {
  if (state.parsing) return false;
  const item = savedLists.find((entry) => entry.id === savedListSelect.value && entry.store === state.store);
  if (!item) return false;
  brandInput.value = item.query;
  state.queryByStore[state.store] = item.query;
  variantsCheckbox.checked = ['eva', 'makeup', 'notino', 'aurora'].includes(state.store)
    && item.options.includeVariants;
  sellersCheckbox.checked = state.store === 'rozetka' && item.options.includeSellers;
  barcodesCheckbox.checked = state.store === 'makeup' && item.options.includeBarcodes;
  hideSuggestions();
  setStatus(`Список «${item.name}» підставлено. Можна починати пошук.`, 'success');
  brandInput.focus();
  return true;
}

function runSavedList() {
  if (applySavedList()) startParsing();
}

function duplicateSavedList() {
  if (state.parsing || !savedListsAvailable) return;
  const item = savedLists.find((entry) => entry.id === savedListSelect.value && entry.store === state.store);
  if (!item) return;
  let suggestion = `${item.name} — копія`;
  let suffix = 2;
  while (savedLists.some((entry) => entry.store === state.store
    && entry.name.toLocaleLowerCase('uk') === suggestion.toLocaleLowerCase('uk'))) {
    suggestion = `${item.name} — копія ${suffix}`;
    suffix += 1;
  }
  const name = window.prompt('Назва копії списку:', suggestion)?.trim();
  if (!name) return;
  const result = savedListUtils.duplicateSavedList(savedLists, item.id, name);
  if (result.conflict) {
    setStatus(`Список «${name}» у цьому магазині вже існує.`, 'error');
    return;
  }
  if (result.full || !result.item) {
    setStatus('Не вдалося створити копію списку.', 'error');
    return;
  }
  savedLists = result.lists;
  if (!writeSavedLists()) {
    setStatus('Не вдалося зберегти копію списку.', 'error');
    return;
  }
  renderSavedLists(result.item.id);
  savedListName.value = result.item.name;
  setStatus(`Створено копію «${result.item.name}».`, 'success');
}

function renameSavedList() {
  if (state.parsing || !savedListsAvailable) return;
  const item = savedLists.find((entry) => entry.id === savedListSelect.value && entry.store === state.store);
  if (!item) return;
  const name = window.prompt('Нова назва списку:', item.name)?.trim();
  if (!name || name === item.name) return;
  const result = savedListUtils.renameSavedList(savedLists, item.id, name);
  if (result.conflict) {
    setStatus(`Список «${name}» у цьому магазині вже існує.`, 'error');
    return;
  }
  if (!result.item) {
    setStatus('Не вдалося перейменувати список.', 'error');
    return;
  }
  savedLists = result.lists;
  if (!writeSavedLists()) {
    setStatus('Не вдалося зберегти нову назву списку.', 'error');
    return;
  }
  renderSavedLists(result.item.id);
  savedListName.value = result.item.name;
  setStatus(`Список перейменовано на «${result.item.name}».`, 'success');
}

function deleteSavedList() {
  if (state.parsing) return;
  const item = savedLists.find((entry) => entry.id === savedListSelect.value && entry.store === state.store);
  if (!item || !window.confirm(`Видалити список «${item.name}»?`)) return;
  savedLists = savedListUtils.removeSavedList(savedLists, item.id);
  if (!writeSavedLists()) {
    setStatus('Не вдалося оновити збережені списки.', 'error');
    return;
  }
  renderSavedLists();
  setStatus(`Список «${item.name}» видалено.`, 'warning');
}

async function exportSavedLists() {
  if (state.parsing || !savedListsAvailable) return;
  exportSavedListsButton.disabled = true;
  setStatus('Готую резервну копію даних…', 'loading');
  try {
    const comparisonSnapshots = typeof parserApi?.listComparisonSnapshots === 'function'
      ? await parserApi.listComparisonSnapshots()
      : [];
    const archives = typeof parserApi?.getAllArchives === 'function' ? await parserApi.getAllArchives() : [];
    const backup = savedListUtils.createSavedListsBackup(
      savedLists,
      new Date().toISOString(),
      searchHistory,
      comparisonSnapshots,
      archives,
    );
    const filePath = await parserApi.exportSavedLists(backup);
    setStatus(
      filePath ? `Резервну копію збережено: ${filePath}` : 'Створення копії скасовано.',
      filePath ? 'success' : 'idle',
    );
  } catch (error) {
    setStatus(batchUtils.cleanParserError(error), 'error');
  } finally {
    updateSavedListButtons();
  }
}

async function importSavedLists() {
  if (state.parsing || !savedListsAvailable) return;
  importSavedListsButton.disabled = true;
  setStatus('Відкриваю резервну копію даних…', 'loading');
  try {
    const selected = await parserApi.importSavedLists();
    if (!selected) {
      setStatus('Відновлення з копії скасовано.', 'idle');
      return;
    }
    const imported = savedListUtils.parsePriceMonitorBackup(selected.contents);
    const listResult = savedListUtils.mergeSavedLists(savedLists, imported.lists);
    const historyResult = searchHistoryUtils.mergeSearchHistory(searchHistory, imported.searchHistory);
    const comparisonResult = typeof parserApi?.mergeComparisonSnapshots === 'function'
      ? await parserApi.mergeComparisonSnapshots(imported.comparisonSnapshots)
      : { added: 0, updated: 0 };
    const archiveResult = typeof parserApi?.mergeArchives === 'function'
      ? await parserApi.mergeArchives(imported.archives)
      : { added: 0 };
    savedLists = listResult.lists;
    searchHistory = historyResult.history;
    if (!writeSavedLists() || !writeSearchHistory()) {
      throw new Error('Не вдалося зберегти відновлені дані на цьому комп’ютері.');
    }
    renderSavedLists();
    renderSearchHistory();
    const details = [
      listResult.added ? `списків додано ${listResult.added}` : '',
      listResult.updated ? `списків оновлено ${listResult.updated}` : '',
      historyResult.added ? `пошуків додано ${historyResult.added}` : '',
      historyResult.updated ? `пошуків оновлено ${historyResult.updated}` : '',
      comparisonResult.added ? `порівнянь додано ${comparisonResult.added}` : '',
      comparisonResult.updated ? `порівнянь оновлено ${comparisonResult.updated}` : '',
      archiveResult.added ? `перевірок додано ${archiveResult.added}` : '',
      listResult.skipped ? `пропущено ${listResult.skipped}` : '',
    ].filter(Boolean).join(', ');
    const hasData = imported.lists.length || imported.searchHistory.length || imported.comparisonSnapshots.length || imported.archives.length;
    setStatus(hasData
      ? `Відновлення завершено: ${details || 'змін немає'}.`
      : 'Резервна копія не містить списків, історії, порівнянь або архіву.', hasData ? 'success' : 'warning');
  } catch (error) {
    setStatus(batchUtils.cleanParserError(error), 'error');
  } finally {
    importSavedListsButton.disabled = false;
    updateSavedListButtons();
  }
}

async function openArchiveDialog() {
  if (state.parsing || archiveActionBusy || typeof parserApi?.listArchives !== 'function') return;
  archiveStoreFilter.value = state.store;
  archiveQueryFilter.value = '';
  archiveDateFrom.value = '';
  archiveDateTo.value = '';
  combinedExportPanel.open = false;
  combinedExportStatus.textContent = '';
  archiveFilteredExportStatus.textContent = '';
  if (archiveDeleteUndoToken) {
    archiveDeleteStatus.textContent = 'Останнє видалення можна скасувати до закриття програми або наступного видалення.';
    archiveDeleteUndoButton.hidden = false;
  }
  archiveList.textContent = 'Завантажую архів…';
  if (!archiveDialog.open) archiveDialog.showModal();
  try {
    archiveSummaries = await parserApi.listArchives();
    renderCombinedExportControls();
    renderArchiveList();
  } catch (_error) { archiveList.textContent = 'Не вдалося відкрити архів.'; }
}

function renderCombinedExportControls() {
  combinedExportStores.replaceChildren();
  for (const store of ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']) {
    const records = archiveSummaries.filter((record) => record.store === store);
    const row = document.createElement('label');
    row.className = 'combined-export-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'combined-export-check';
    checkbox.checked = Boolean(records.length);
    checkbox.disabled = !records.length;
    checkbox.setAttribute('aria-label', `Додати ${storeName(store)} до зведеного Excel`);
    const name = document.createElement('strong');
    name.textContent = storeName(store);
    const select = document.createElement('select');
    select.className = 'combined-export-select';
    select.dataset.store = store;
    select.setAttribute('aria-label', `Перевірка ${storeName(store)}`);
    select.disabled = !records.length;
    if (!records.length) {
      const option = document.createElement('option');
      option.textContent = 'Немає збережених перевірок';
      select.appendChild(option);
    }
    for (const record of records) {
      const option = archiveSelectOption(record);
      option.textContent = `${formatComparisonDate(record.capturedAt)} · ${record.query} · ${record.productCount} ${ukPlural(record.productCount, 'рядок', 'рядки', 'рядків')}${record.truncated ? ' · скорочено' : ''}`;
      select.appendChild(option);
    }
    row.append(checkbox, name, select);
    combinedExportStores.appendChild(row);
  }
  updateCombinedExportState();
}

function combinedArchiveIds() {
  return [...combinedExportStores.querySelectorAll('.combined-export-row')]
    .filter((row) => row.querySelector('.combined-export-check').checked)
    .map((row) => row.querySelector('.combined-export-select').value);
}

function updateCombinedExportState() {
  for (const row of combinedExportStores.querySelectorAll('.combined-export-row')) {
    const checkbox = row.querySelector('.combined-export-check');
    const select = row.querySelector('.combined-export-select');
    select.disabled = archiveActionBusy || checkbox.disabled || !checkbox.checked;
  }
  const ids = combinedArchiveIds();
  const selected = ids.map((id) => archiveSummaries.find((record) => record.id === id)).filter(Boolean);
  const count = selected.length;
  const rows = selected.reduce((sum, record) => sum + record.productCount, 0);
  const truncated = selected.filter((record) => record.truncated).length;
  combinedExportButton.disabled = archiveActionBusy || state.parsing || count < 2;
  combinedExportHint.textContent = count < 2
    ? 'Виберіть щонайменше два магазини зі збереженими перевірками.'
    : `${count} ${ukPlural(count, 'магазин', 'магазини', 'магазинів')} · ${rows} ${ukPlural(rows, 'рядок', 'рядки', 'рядків')}${truncated ? ` · ${truncated} ${ukPlural(truncated, 'скорочений архів', 'скорочені архіви', 'скорочених архівів')}` : ''}. Час кожної перевірки буде в кожному рядку Excel.`;
}

async function exportCombinedArchives() {
  if (state.parsing || archiveActionBusy) return;
  const ids = combinedArchiveIds();
  if (ids.length < 2) return;
  setArchiveActionBusy(true);
  combinedExportStatus.textContent = 'Готую зведений Excel…';
  try {
    const filePath = await parserApi.exportCombinedArchives(ids);
    combinedExportStatus.textContent = filePath
      ? `Зведений Excel збережено: ${filePath}` : 'Збереження скасовано.';
  } catch (error) {
    combinedExportStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    setArchiveActionBusy(false);
  }
}

function renderArchiveList() {
  archiveList.replaceChildren();
  const query = archiveQueryFilter.value.normalize('NFKC').trim().toLocaleLowerCase('uk');
  const from = archiveDateFrom.value;
  const to = archiveDateTo.value;
  const records = archiveSummaries.filter((record) => {
    if (archiveStoreFilter.value !== 'all' && record.store !== archiveStoreFilter.value) return false;
    if (query && !`${record.query} ${record.brand || ''}`.normalize('NFKC').toLocaleLowerCase('uk').includes(query)) return false;
    const day = record.capturedAt.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });
  filteredArchiveSummaries = records;
  archiveFilterSummary.textContent = `Показано ${records.length} із ${archiveSummaries.length} ${ukPlural(archiveSummaries.length, 'перевірки', 'перевірок', 'перевірок')}${from && to && from > to ? ' · дата «від» пізніше за «до»' : ''}. Дати фільтру — UTC.`;
  updateFilteredArchiveExportState();
  renderArchiveCompareControls(records);
  if (!records.length) {
    archiveList.textContent = archiveSummaries.length
      ? 'За цими фільтрами перевірок не знайдено. Очистіть фільтри або виберіть інший магазин.'
      : 'Ще немає збережених перевірок. Зробіть повний успішний пошук — він з’явиться тут автоматично.';
    return;
  }
  for (const record of records) {
    const row = document.createElement('div');
    row.className = 'archive-item';
    const description = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${storeName(record.store)} · ${record.query}`;
    const caption = document.createElement('small');
    const modes = historyModeLabels(record.options);
    caption.textContent = `${formatComparisonDate(record.capturedAt)} · ${record.productCount} ${ukPlural(record.productCount, 'рядок', 'рядки', 'рядків')}${modes ? ` · ${modes}` : ''}${record.truncated ? ` · скорочено з ${record.sourceCount}` : ''}`;
    description.append(title, caption);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compact-button archive-open';
    button.textContent = 'Відкрити';
    button.disabled = state.parsing;
    button.addEventListener('click', () => openArchivedResult(record.id));
    const repeatButton = document.createElement('button');
    repeatButton.type = 'button';
    repeatButton.className = 'compact-button archive-repeat';
    repeatButton.textContent = 'Повторити пошук';
    repeatButton.title = 'Новий пошук з тим самим магазином, запитом і режимами';
    repeatButton.disabled = state.parsing || archiveActionBusy || isAccessBlocked();
    repeatButton.addEventListener('click', () => repeatArchivedSearch(record.id));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'compact-button danger-button archive-delete';
    deleteButton.textContent = 'Видалити';
    deleteButton.title = 'Видалити цю перевірку з архіву та історії ціни';
    deleteButton.disabled = state.parsing || archiveActionBusy;
    deleteButton.addEventListener('click', () => deleteArchiveRecords([record]));
    const actions = document.createElement('div');
    actions.className = 'archive-actions';
    actions.append(button, repeatButton, deleteButton);
    row.append(description, actions);
    archiveList.appendChild(row);
  }
}

function refreshArchiveFilters() {
  archiveFilteredExportStatus.textContent = '';
  renderArchiveList();
}

function updateFilteredArchiveExportState() {
  const count = filteredArchiveSummaries.length;
  const rows = filteredArchiveSummaries.reduce((sum, record) => sum + Number(record.productCount || 0), 0);
  archiveFilteredExportButton.disabled = archiveActionBusy || state.parsing || !count;
  archiveFilteredDeleteButton.disabled = archiveActionBusy || state.parsing || !count;
  archiveFilteredExportHint.textContent = count
    ? `${count} ${ukPlural(count, 'перевірка', 'перевірки', 'перевірок')} · ${rows} ${ukPlural(rows, 'рядок', 'рядки', 'рядків')}. Кожен рядок матиме магазин, дату UTC й запит.`
    : 'За поточними фільтрами немає перевірок для експорту.';
}

function deleteFilteredArchives() {
  if (state.parsing || archiveActionBusy || !filteredArchiveSummaries.length) return;
  deleteArchiveRecords(filteredArchiveSummaries);
}

async function deleteArchiveRecords(records) {
  if (state.parsing || archiveActionBusy || !records.length) return;
  const count = records.length;
  const rows = records.reduce((sum, record) => sum + Number(record.productCount || 0), 0);
  const subject = count === 1
    ? `${storeName(records[0].store)} · ${records[0].query} · ${formatComparisonDate(records[0].capturedAt)}`
    : `${count} ${ukPlural(count, 'показану перевірку', 'показані перевірки', 'показаних перевірок')}`;
  const confirmed = window.confirm(`Видалити ${subject}?\n\nЗ архіву та історії ціни зникне ${rows} ${ukPlural(rows, 'рядок', 'рядки', 'рядків')}. Списки, історія запитів і база порівняння не зміняться. Видалення можна одразу скасувати.`);
  if (!confirmed) return;
  setArchiveActionBusy(true);
  archiveDeleteStatus.textContent = 'Видаляю вибрані перевірки…';
  archiveDeleteUndoButton.hidden = true;
  try {
    const result = await parserApi.deleteArchives(records.map((record) => record.id));
    archiveDeleteUndoToken = result.token;
    archiveSummaries = await parserApi.listArchives();
    renderCombinedExportControls();
    renderArchiveList();
    archiveDeleteStatus.textContent = `Видалено ${result.removed} ${ukPlural(result.removed, 'перевірку', 'перевірки', 'перевірок')}. В архіві залишилося ${result.total}.`;
    archiveDeleteUndoButton.hidden = false;
  } catch (error) {
    archiveDeleteStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    setArchiveActionBusy(false);
  }
}

async function restoreDeletedArchives() {
  if (state.parsing || archiveActionBusy || !archiveDeleteUndoToken) return;
  setArchiveActionBusy(true);
  archiveDeleteStatus.textContent = 'Відновлюю видалені перевірки…';
  try {
    const result = await parserApi.restoreDeletedArchives(archiveDeleteUndoToken);
    archiveDeleteUndoToken = '';
    archiveDeleteUndoButton.hidden = true;
    archiveSummaries = await parserApi.listArchives();
    renderCombinedExportControls();
    renderArchiveList();
    archiveDeleteStatus.textContent = `Відновлено ${result.restored} ${ukPlural(result.restored, 'перевірку', 'перевірки', 'перевірок')}.`;
  } catch (error) {
    archiveDeleteStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    setArchiveActionBusy(false);
  }
}

async function exportFilteredArchives() {
  if (state.parsing || archiveActionBusy || !filteredArchiveSummaries.length) return;
  const ids = filteredArchiveSummaries.map((record) => record.id);
  setArchiveActionBusy(true);
  archiveFilteredExportStatus.textContent = 'Готую Excel з показаних перевірок…';
  try {
    const filePath = await parserApi.exportFilteredArchives(ids);
    archiveFilteredExportStatus.textContent = filePath
      ? `Архівний Excel збережено: ${filePath}` : 'Збереження скасовано.';
  } catch (error) {
    archiveFilteredExportStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    setArchiveActionBusy(false);
  }
}

async function openChangeReport() {
  if (state.parsing || changeReportBusy || typeof parserApi?.getChangeOverview !== 'function') return;
  changeReportStoreFilter.value = 'all';
  changeReportStatusFilter.value = 'all';
  changeReportTextFilter.value = '';
  changeReportDateFrom.value = '';
  changeReportDateTo.value = '';
  changeReportPeriodStatus.textContent = 'Показано найновішу сумісну пару за весь час.';
  if (!changeReportDialog.open) changeReportDialog.showModal();
  await loadChangeReport({});
}

async function loadChangeReport(period) {
  if (changeReportBusy || typeof parserApi?.getChangeOverview !== 'function') return;
  changeReportBusy = true;
  setChangeReportPeriodBusy(true);
  changeOverview = null;
  changeReportStores.textContent = 'Завантажую збережені перевірки…';
  changeReportRows.replaceChildren();
  changeReportCount.textContent = '';
  changeReportExportStatus.textContent = '';
  exportChangeReportButton.disabled = true;
  try {
    const report = await parserApi.getChangeOverview(period);
    if (!changeReportDialog.open) return;
    changeOverview = report;
    renderChangeReportStores();
    renderChangeReportRows();
    changeReportPeriodStatus.textContent = report.period?.active
      ? `Період: ${report.period.from} — ${report.period.to} включно (UTC). Для кожного магазину використано найранішу та найпізнішу сумісні перевірки всередині цих меж.`
      : 'Показано найновішу сумісну пару за весь час.';
    exportChangeReportButton.disabled = !report.storeReports.some((item) => item.comparable);
  } catch (error) {
    changeReportStores.textContent = `Не вдалося побудувати звіт: ${batchUtils.cleanParserError(error)}`;
    changeReportPeriodStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    changeReportBusy = false;
    setChangeReportPeriodBusy(false);
  }
}

function selectedChangeReportPeriod() {
  const from = changeReportDateFrom.value;
  const to = changeReportDateTo.value;
  if ((from && !to) || (!from && to)) throw new Error('Оберіть обидві дати періоду або очистьте їх.');
  if (from && from > to) throw new Error('Дата «від» не може бути пізнішою за дату «до».');
  return from && to ? { from, to } : {};
}

function applyChangeReportPeriod() {
  try {
    loadChangeReport(selectedChangeReportPeriod());
  } catch (error) {
    changeReportPeriodStatus.textContent = error.message;
  }
}

function applyChangeReportPreset(days) {
  if (!Number.isInteger(days) || days < 2) return;
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  today.setUTCDate(today.getUTCDate() - (days - 1));
  changeReportDateFrom.value = today.toISOString().slice(0, 10);
  changeReportDateTo.value = to;
  loadChangeReport({ from: changeReportDateFrom.value, to: changeReportDateTo.value });
}

function showAllTimeChangeReport() {
  changeReportDateFrom.value = '';
  changeReportDateTo.value = '';
  loadChangeReport({});
}

function markChangeReportPeriodPending() {
  if (!changeReportBusy) changeReportPeriodStatus.textContent = 'Дати змінено. Натисніть «Побудувати звіт», щоб застосувати період.';
}

function setChangeReportPeriodBusy(busy) {
  changeReportDateFrom.disabled = busy;
  changeReportDateTo.disabled = busy;
  changeReportApplyPeriod.disabled = busy;
  changeReportAllTime.disabled = busy;
  changeReportPresetButtons.forEach((button) => { button.disabled = busy; });
}

function renderChangeReportStores() {
  changeReportStores.replaceChildren();
  for (const item of changeOverview?.storeReports || []) {
    const card = document.createElement('div');
    card.className = 'change-report-store';
    const title = document.createElement('strong');
    title.textContent = item.label;
    card.appendChild(title);
    if (item.comparable) {
      const dates = document.createElement('small');
      dates.textContent = `${formatComparisonDate(item.previousCapturedAt)} → ${formatComparisonDate(item.currentCapturedAt)}`;
      const query = document.createElement('small');
      query.textContent = `Запит: ${item.currentQuery}`;
      const counts = document.createElement('span');
      counts.textContent = `Нові ${item.summary.new} · дешевші ${item.summary.cheaper} · дорожчі ${item.summary.expensive} · без змін ${item.summary.unchanged} · зникли з видачі ${item.summary.missing}`;
      card.append(dates, query, counts);
    } else {
      const reason = document.createElement('span');
      reason.textContent = item.reason;
      card.appendChild(reason);
    }
    changeReportStores.appendChild(card);
  }
}

function renderChangeReportRows() {
  changeReportRows.replaceChildren();
  if (!changeOverview) return;
  const query = changeReportTextFilter.value.normalize('NFKC').trim().toLocaleLowerCase('uk');
  const matches = changeOverview.rows.filter((row) =>
    (changeReportStoreFilter.value === 'all' || row.store === changeReportStoreFilter.value)
    && (changeReportStatusFilter.value === 'all' || row.status === changeReportStatusFilter.value)
    && (!query || [row.name, row.brand, row.barcode, row.variant, row.seller].join(' ').normalize('NFKC').toLocaleLowerCase('uk').includes(query)));
  changeReportCount.textContent = `${matches.length} ${ukPlural(matches.length, 'зміна', 'зміни', 'змін')} за фільтрами${matches.length > 200 ? ' · на екрані перші 200; Excel містить увесь звіт' : ''}.`;
  const labels = { new: 'Новий у видачі', cheaper: 'Подешевшав', expensive: 'Подорожчав', missing: 'Зник із видачі' };
  for (const row of matches.slice(0, 200)) {
    const tr = document.createElement('tr');
    const product = textCell(row.name);
    const detail = document.createElement('small');
    detail.textContent = [row.brand, row.barcode, row.variant, row.seller].filter(Boolean).join(' · ');
    product.appendChild(detail);
    tr.append(textCell(row.storeLabel), product, textCell(labels[row.status] || row.status),
      priceCell(row.previousPrice), priceCell(row.currentPrice),
      priceCell(row.difference));
    changeReportRows.appendChild(tr);
  }
  if (!matches.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'За цими фільтрами змін немає. Дані про сумісні й пропущені магазини наведено вище.';
    row.appendChild(cell);
    changeReportRows.appendChild(row);
  }
}

async function exportChangeReport() {
  if (changeReportBusy || exportChangeReportButton.disabled || !changeOverview) return;
  changeReportBusy = true;
  exportChangeReportButton.disabled = true;
  changeReportExportStatus.textContent = 'Готую повний Excel-звіт…';
  try {
    const filePath = await parserApi.exportChangeOverview(changeOverview.period || {});
    changeReportExportStatus.textContent = filePath ? `Звіт збережено: ${filePath}` : 'Збереження скасовано.';
  } catch (error) {
    changeReportExportStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    changeReportBusy = false;
    exportChangeReportButton.disabled = !changeOverview?.storeReports.some((item) => item.comparable);
  }
}

function renderArchiveCompareControls(records) {
  const previousId = archiveCompareBase.value;
  archiveCompareBase.replaceChildren();
  const eligible = records.filter((previous) => records.some((current) => archiveTools.canCompareArchives(previous, current)));
  for (const record of eligible) archiveCompareBase.appendChild(archiveSelectOption(record));
  if (eligible.some((record) => record.id === previousId)) archiveCompareBase.value = previousId;
  archiveCompareBase.disabled = archiveActionBusy || !eligible.length;
  updateArchiveCompareTargets();
}

function archiveSelectOption(record) {
  const option = document.createElement('option');
  option.value = record.id;
  option.textContent = `${formatComparisonDate(record.capturedAt)} · ${storeName(record.store)} · ${record.query}`;
  return option;
}

function updateArchiveCompareTargets() {
  const previous = archiveSummaries.find((record) => record.id === archiveCompareBase.value);
  const selectedId = archiveCompareCurrent.value;
  archiveCompareCurrent.replaceChildren();
  const later = archiveSummaries.filter((record) => archiveTools.canCompareArchives(previous, record));
  for (const record of later) archiveCompareCurrent.appendChild(archiveSelectOption(record));
  if (later.some((record) => record.id === selectedId)) archiveCompareCurrent.value = selectedId;
  archiveCompareCurrent.disabled = archiveActionBusy || !later.length;
  archiveCompareButton.disabled = archiveActionBusy || !later.length;
  archiveCompareHint.textContent = later.length
    ? 'Однаковий магазин, запит і режими. Ціни й зміни стосуються вибраних дат, не сьогоднішніх залишків. База наступного нового пошуку не змінюється.'
    : 'Потрібні дві повні перевірки однакового запиту й режимів в одному магазині. Скорочені архіви не порівнюються.';
}

function setArchiveActionBusy(busy) {
  archiveActionBusy = busy;
  archiveStoreFilter.disabled = busy;
  archiveCompareBase.disabled = busy || !archiveCompareBase.options.length;
  archiveCompareCurrent.disabled = busy || !archiveCompareCurrent.options.length;
  archiveCompareButton.disabled = busy || !archiveCompareCurrent.value;
  archiveList.querySelectorAll('button').forEach((button) => { button.disabled = busy || state.parsing; });
  combinedExportStores.querySelectorAll('.combined-export-check').forEach((checkbox) => {
    checkbox.disabled = busy || !archiveSummaries.some((record) => record.store === checkbox.parentElement.querySelector('.combined-export-select').dataset.store);
  });
  updateCombinedExportState();
  updateFilteredArchiveExportState();
  archiveDeleteUndoButton.disabled = busy || !archiveDeleteUndoToken;
}

async function compareSelectedArchives() {
  if (state.parsing || archiveActionBusy || !archiveCompareBase.value || !archiveCompareCurrent.value) return;
  setArchiveActionBusy(true);
  try {
    const result = await parserApi.compareArchives(archiveCompareBase.value, archiveCompareCurrent.value);
    if (state.parsing) return;
    displayArchivedResult(result.record, result.comparison);
  } catch (error) { archiveCompareHint.textContent = batchUtils.cleanParserError(error); }
  finally { setArchiveActionBusy(false); }
}

async function repeatArchivedSearch(id) {
  if (state.parsing || archiveActionBusy) return;
  setArchiveActionBusy(true);
  try {
    const record = await parserApi.getArchive(id);
    if (!record) throw new Error('Ця перевірка вже відсутня в архіві.');
    if (state.parsing) return;
    applyStore(record.store);
    if (applySearchHistoryItem(record)) {
      archiveDialog.close();
      await startParsing();
    }
  } catch (error) { archiveCompareHint.textContent = batchUtils.cleanParserError(error); }
  finally { setArchiveActionBusy(false); }
}

async function openArchivedResult(id) {
  if (state.parsing || archiveActionBusy) return;
  setArchiveActionBusy(true);
  try {
    const record = await parserApi.getArchive(id);
    if (!record || state.parsing) return;
    displayArchivedResult(record);
  } catch (_error) { setStatus('Не вдалося відкрити збережений результат.', 'error'); }
  finally { setArchiveActionBusy(false); }
}

function displayArchivedResult(record, comparison = null) {
    applyStore(record.store);
    brandInput.value = record.query;
    state.queryByStore[record.store] = record.query;
    state.brand = record.brand;
    state.products = comparison?.products || record.products;
    state.comparison = comparison;
    state.variantMode = record.options.includeVariants || record.products.some((product) => product.variant);
    state.sellerMode = record.options.includeSellers;
    state.barcodeMode = record.options.includeBarcodes;
    state.detailedMode = state.variantMode || state.sellerMode || state.barcodeMode;
    variantsCheckbox.checked = record.options.includeVariants;
    sellersCheckbox.checked = record.options.includeSellers;
    barcodesCheckbox.checked = record.options.includeBarcodes;
    state.capture = {
      source: 'archive', capturedAt: record.capturedAt, complete: true,
      sourceCount: record.sourceCount, truncated: record.truncated,
      query: record.query, options: record.options,
    };
    archiveDialog.close();
    renderProducts();
    updateResultMeta(1, 1);
    setStatus(`Відкрито архів від ${formatComparisonDate(record.capturedAt)}. Для актуальних цін запустіть новий пошук.`, 'warning');
}

async function showProductPriceHistory(product) {
  if (state.parsing || typeof parserApi?.getProductPriceHistory !== 'function') return;
  const request = ++priceHistoryRequest;
  const store = state.store;
  priceHistorySelection = null;
  exportPriceHistoryButton.disabled = true;
  priceHistoryExportStatus.textContent = '';
  priceHistoryTitle.textContent = product.name || 'Історія ціни';
  priceHistoryContext.textContent = [storeName(store), product.brand, product.variant, product.seller].filter(Boolean).join(' · ');
  priceHistoryRows.replaceChildren();
  priceHistoryChart.replaceChildren();
  priceHistoryStats.textContent = 'Завантажую історію…';
  priceHistoryTableWrap.hidden = true;
  if (!priceHistoryDialog.open) priceHistoryDialog.showModal();
  try {
    const points = await parserApi.getProductPriceHistory(store, product);
    if (request !== priceHistoryRequest || !priceHistoryDialog.open) return;
    if (!points.length) {
      priceHistoryStats.textContent = 'Ще немає збережених цін для цієї точної позиції. Історія з’явиться після повного успішного пошуку.';
      return;
    }
    priceHistorySelection = { store, product };
    exportPriceHistoryButton.disabled = false;
    const prices = points.map((point) => point.price);
    const difference = Math.round((prices.at(-1) - prices[0]) * 100) / 100;
    priceHistoryStats.textContent = `${points.length} ${ukPlural(points.length, 'перевірка', 'перевірки', 'перевірок')} · Мінімум ${formatPrice(Math.min(...prices))} · Максимум ${formatPrice(Math.max(...prices))} · Зміна ${difference > 0 ? '+' : difference < 0 ? '−' : ''}${formatPrice(Math.abs(difference))}`;
    drawPriceHistoryChart(points);
    for (const point of [...points].reverse()) {
      const row = document.createElement('tr');
      row.append(textCell(formatComparisonDate(point.capturedAt)), priceCell(point.price), priceCell(point.regularPrice), textCell(point.query));
      priceHistoryRows.appendChild(row);
    }
    priceHistoryTableWrap.hidden = false;
  } catch (_error) { priceHistoryStats.textContent = 'Не вдалося завантажити історію ціни.'; }
}

async function exportPriceHistory() {
  const selected = priceHistorySelection;
  if (!selected || exportPriceHistoryButton.disabled || state.parsing) return;
  exportPriceHistoryButton.disabled = true;
  priceHistoryExportStatus.textContent = 'Готую Excel…';
  try {
    const filePath = await parserApi.exportProductPriceHistory(selected.store, selected.product);
    if (priceHistorySelection === selected && priceHistoryDialog.open) {
      priceHistoryExportStatus.textContent = filePath ? 'Історію ціни збережено в Excel.' : 'Збереження скасовано.';
    }
  } catch (error) {
    if (priceHistorySelection === selected) priceHistoryExportStatus.textContent = batchUtils.cleanParserError(error);
  } finally {
    if (priceHistorySelection === selected) exportPriceHistoryButton.disabled = false;
  }
}

function drawPriceHistoryChart(points) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 720 250');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Графік поточної ціни: ${points.length} збережених перевірок. Точні значення наведено у таблиці нижче.`);
  const prices = points.map((point) => point.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * 0.1, maximum * 0.02, 1);
  const lower = Math.max(0, minimum - padding);
  const upper = maximum + padding;
  const dates = points.map((point) => Date.parse(point.capturedAt));
  const span = dates.at(-1) - dates[0];
  const x = (index) => span > 0 ? 62 + ((dates[index] - dates[0]) / span) * 626 : 375;
  const y = (value) => 210 - ((value - lower) / (upper - lower)) * 180;
  const add = (name, attributes, text) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };
  for (let index = 0; index < 3; index += 1) {
    const value = lower + (upper - lower) * index / 2;
    add('line', { x1: 62, x2: 688, y1: y(value), y2: y(value), class: 'chart-grid' });
    add('text', { x: 55, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label' }, new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(value));
  }
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.price)}`).join(' ');
  add('path', { d: path, class: 'chart-line' });
  points.forEach((point, index) => {
    const circle = add('circle', { cx: x(index), cy: y(point.price), r: 4, class: 'chart-point' });
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${formatComparisonDate(point.capturedAt)} — ${formatPrice(point.price)}`;
    circle.appendChild(title);
  });
  add('text', { x: 62, y: 237, class: 'chart-label' }, formatComparisonDate(points[0].capturedAt));
  if (points.length > 1) add('text', { x: 688, y: 237, 'text-anchor': 'end', class: 'chart-label' }, formatComparisonDate(points.at(-1).capturedAt));
  priceHistoryChart.appendChild(svg);
}

function readSearchHistory() {
  if (!searchHistoryAvailable) return [];
  try {
    return searchHistoryUtils.parseSearchHistory(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY));
  } catch (_error) {
    return [];
  }
}

function writeSearchHistory() {
  try {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
    return true;
  } catch (_error) {
    return false;
  }
}

function renderSearchHistory() {
  const items = searchHistoryAvailable
    ? searchHistoryUtils.historyForStore(searchHistory, state.store)
    : [];
  searchHistoryList.replaceChildren();
  searchHistoryCount.textContent = items.length ? `· ${items.length}` : '';
  clearSearchHistoryButton.disabled = state.parsing || !items.length;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'У цьому магазині історія ще порожня.';
    searchHistoryList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const description = document.createElement('div');
    description.className = 'history-description';
    const title = document.createElement('strong');
    title.textContent = item.query;
    title.title = item.query;
    const meta = document.createElement('small');
    const resultText = item.outcome === 'stopped'
      ? `зупинено · зібрано ${formatProductCount(item.productCount, item.store)}`
      : item.outcome === 'error'
        ? 'завершено з помилкою'
        : formatProductCount(item.productCount, item.store);
    const modes = historyModeLabels(item.options);
    meta.textContent = `${formatHistoryDate(item.searchedAt)} · ${resultText}${modes ? ` · ${modes}` : ''}`;
    description.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'compact-button history-apply';
    applyButton.textContent = 'Підставити';
    applyButton.disabled = state.parsing;
    applyButton.addEventListener('click', () => applySearchHistoryItem(item));
    const repeatButton = document.createElement('button');
    repeatButton.type = 'button';
    repeatButton.className = 'compact-button accent-button history-repeat';
    repeatButton.textContent = 'Повторити';
    repeatButton.disabled = state.parsing || isAccessBlocked();
    repeatButton.addEventListener('click', () => repeatSearchHistoryItem(item));
    actions.append(applyButton, repeatButton);
    row.append(description, actions);
    searchHistoryList.appendChild(row);
  });
}

function recordSearchHistory(query, productCount, outcome, options) {
  if (!searchHistoryAvailable) return;
  const result = searchHistoryUtils.addSearchHistory(searchHistory, {
    store: state.store,
    query,
    productCount,
    outcome,
    options,
  });
  if (!result.item) return;
  searchHistory = result.history;
  writeSearchHistory();
  renderSearchHistory();
  updateSavedListButtons();
}

function applySearchHistoryItem(item) {
  if (state.parsing || item.store !== state.store) return false;
  brandInput.value = item.query;
  state.queryByStore[state.store] = item.query;
  variantsCheckbox.checked = ['eva', 'makeup', 'notino', 'aurora'].includes(state.store)
    && item.options.includeVariants;
  sellersCheckbox.checked = state.store === 'rozetka' && item.options.includeSellers;
  barcodesCheckbox.checked = state.store === 'makeup' && item.options.includeBarcodes;
  hideSuggestions();
  setStatus('Запит з історії підставлено. Можна починати пошук.', 'success');
  brandInput.focus();
  return true;
}

function repeatSearchHistoryItem(item) {
  if (applySearchHistoryItem(item)) startParsing();
}

function clearStoreSearchHistory() {
  if (state.parsing || !searchHistoryAvailable) return;
  if (!window.confirm(`Очистити історію пошуків магазину ${storeName(state.store)}?`)) return;
  searchHistory = searchHistoryUtils.clearSearchHistoryStore(searchHistory, state.store);
  writeSearchHistory();
  renderSearchHistory();
  updateSavedListButtons();
  setStatus('Історію пошуків цього магазину очищено.', 'warning');
}

function historyModeLabels(options) {
  const modes = [];
  if (options?.includeVariants) modes.push('варіанти');
  if (options?.includeSellers) modes.push('продавці');
  if (options?.includeBarcodes) modes.push('штрихкоди');
  return modes.join(', ');
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'невідома дата';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatProductCount(value, store) {
  const count = Math.max(0, Number(value) || 0);
  const word = store === 'rozetka'
    ? ukPlural(count, 'пропозиція', 'пропозиції', 'пропозицій')
    : ukPlural(count, 'товар', 'товари', 'товарів');
  return `${count} ${word}`;
}

function ukPlural(value, one, few, many) {
  const count = Math.abs(Math.trunc(Number(value) || 0));
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function looksLikeBarcodeInput(value) {
  const compact = String(value || '').replace(/[\s-]+/g, '');
  return /^\d+$/.test(compact) && [8, 12, 13, 14].includes(compact.length);
}

async function startParsing() {
  if (!parserAvailable) return showLaunchHint();
  const queries = batchUtils.splitBrandQueries(brandInput.value);
  if (!queries.length) {
    setStatus('Введіть одну або кілька торгових марок', 'error');
    brandInput.focus();
    return;
  }
  if (state.parsing) return;

  let searchAccess = { allowed: true, token: '', status: accessStatus };
  if (typeof parserApi?.beginSearchAccess === 'function') {
    try {
      searchAccess = await parserApi.beginSearchAccess(state.store, queries.length);
      if (searchAccess?.status) updateAccessUi(searchAccess.status);
    } catch (_error) {
      setStatus('Не вдалося перевірити доступ. Перезапустіть програму.', 'error');
      return;
    }
  }
  if (!searchAccess?.allowed) {
    setStatus(accessDeniedMessage(searchAccess?.reason, searchAccess?.status), 'error');
    return;
  }
  const accessToken = String(searchAccess.token || '');

  hideSuggestions();
  clearResults();
  state.parsing = true;
  state.cancelRequested = false;
  state.batch = { index: 0, total: queries.length, query: queries[0] };
  pendingStore = null;
  setControlsBusy(true);
  const requestedStore = state.store;
  const barcodeSearch = requestedStore === 'makeup' && queries.some(looksLikeBarcodeInput);
  const includeVariants = ['eva', 'makeup', 'notino', 'aurora'].includes(requestedStore) && variantsCheckbox.checked;
  const includeSellers = requestedStore === 'rozetka' && sellersCheckbox.checked;
  const includeBarcodes = requestedStore === 'makeup' && (barcodesCheckbox.checked || barcodeSearch);
  const searchQuery = brandInput.value.trim();
  const historyOptions = { includeVariants, includeSellers, includeBarcodes };
  state.capture = {
    source: 'live',
    query: searchQuery,
    options: historyOptions,
    capturedAt: new Date().toISOString(),
    complete: false,
    sourceCount: 0,
  };
  const snapshotKey = comparisonAvailable
    ? comparisonUtils.createSnapshotKey(requestedStore, searchQuery, historyOptions)
    : '';
  const previousSnapshotPromise = comparisonAvailable
    ? parserApi.getComparisonSnapshot(snapshotKey).catch(() => null)
    : Promise.resolve(null);
  let comparisonSaveFailed = false;
  let archiveSaveFailed = false;
  setStatus(queries.length > 1
    ? `Запит 1 із ${queries.length} · починаю пошук…`
    : barcodeSearch ? 'Шукаю товар за штрихкодом…' : 'Шукаю торгову марку…', 'loading');
  state.detailedMode = includeVariants || includeSellers || includeBarcodes;
  state.variantMode = includeVariants || barcodeSearch;
  state.sellerMode = includeSellers;
  state.barcodeMode = includeBarcodes;

  try {
    const result = await batchUtils.runBrandBatch(
      queries,
      (query) => parserApi.parseBrand(requestedStore, query, {
        includeVariants,
        includeSellers,
        includeBarcodes,
        accessToken,
        previousProducts: state.products,
        recoveryQuery: brandInput.value,
      }),
      {
        shouldStop: () => state.cancelRequested || Boolean(pendingStore) || requestedStore !== state.store,
        onStart: ({ query, index, total }) => {
          state.batch = { query, index, total };
          const barcodeItem = requestedStore === 'makeup' && looksLikeBarcodeInput(query);
          setStatus(
            total > 1
              ? `Запит ${index + 1} із ${total} · ${barcodeItem ? 'перевіряю штрихкод' : 'шукаю марку'} «${query}»…`
              : barcodeItem ? 'Шукаю товар за штрихкодом…' : 'Шукаю торгову марку…',
            'loading',
          );
        },
        onSuccess: ({ products, brand, index, total }) => {
          if (pendingStore || requestedStore !== state.store) return;
          state.products = products;
          state.brand = appendBrand(state.brand, brand);
          renderProducts();
          updateResultMeta(index + 1, total);
        },
        onError: ({ query, message, index, total }) => {
          if (pendingStore || requestedStore !== state.store) return;
          setStatus(
            total > 1
              ? `Запит ${index + 1} із ${total} · «${query}»: ${message}. Продовжую…`
              : message,
            total > 1 ? 'warning' : 'error',
          );
        },
      },
    );
    if (pendingStore || requestedStore !== state.store) return;
    state.products = result.products;
    state.brand = result.successes.map((item) => item.brand).join(', ') || queries.join(', ');
    const completeResult = !result.stopped
      && result.failures.length === 0
      && result.successes.length === result.queries.length
      && state.products.length > 0;
    state.capture.complete = completeResult;
    state.capture.sourceCount = state.products.length;
    state.capture.capturedAt = new Date().toISOString();
    if (completeResult && comparisonAvailable) {
      const previousSnapshot = await previousSnapshotPromise;
      const compared = comparisonUtils.compareWithSnapshot(state.products, previousSnapshot);
      state.products = compared.products;
      state.comparison = { ...compared, snapshotKey };
      const snapshot = comparisonUtils.createComparisonSnapshot({
        key: snapshotKey,
        store: requestedStore,
        query: searchQuery,
        options: historyOptions,
        products: state.products,
      });
      try {
        await parserApi.saveComparisonSnapshot(snapshot);
      } catch (_error) {
        comparisonSaveFailed = true;
      }
    }
    if (completeResult && typeof parserApi.saveArchive === 'function') {
      try {
        await parserApi.saveArchive({
          ...state.capture,
          store: requestedStore,
          brand: state.brand,
          products: state.products,
        });
      } catch (_error) { archiveSaveFailed = true; }
    }
    renderProducts();
    updateResultMeta(result.successes.length, result.queries.length);

    if (!result.stopped) await parserApi.clearRecovery?.().catch(() => {});

    if (result.stopped) {
      setStatus(`Пошук зупинено. Зібрано ${formatProductCount(state.products.length, state.store)}`, state.products.length ? 'warning' : 'idle');
    } else if (result.failures.length && result.successes.length) {
      const failedNames = result.failures.slice(0, 3).map((item) => item.query).join(', ');
      const more = result.failures.length > 3 ? ` та ще ${result.failures.length - 3}` : '';
      setStatus(
        `Готово: ${formatProductCount(state.products.length, state.store)}. Не вдалося обробити: ${failedNames}${more}`,
        'warning',
      );
    } else if (result.failures.length) {
      setStatus(result.failures[0].message, 'error');
    } else {
      setStatus(`Готово: знайдено ${formatProductCount(state.products.length, state.store)}`, 'success');
    }
    if (comparisonSaveFailed) {
      setStatus(`${statusElement.textContent}. Не вдалося зберегти знімок для наступного порівняння.`, 'warning');
    }
    if (archiveSaveFailed) {
      setStatus(`${statusElement.textContent}. Не вдалося зберегти результат в архів.`, 'warning');
    }
    if (accessStatus.isDemo && state.products.length >= Number(accessStatus.maxResults || 1000)) {
      setStatus(`${statusElement.textContent}. Демо-ліміт: показано не більше ${accessStatus.maxResults || 1000} рядків.`, 'warning');
    }
    recordSearchHistory(
      searchQuery,
      state.products.length,
      result.stopped ? 'stopped' : result.successes.length ? 'success' : 'error',
      historyOptions,
    );
  } catch (error) {
    if (!pendingStore) {
      setStatus(batchUtils.cleanParserError(error), 'error');
      recordSearchHistory(searchQuery, state.products.length, 'error', historyOptions);
    }
  } finally {
    if (accessToken && typeof parserApi?.finishSearchAccess === 'function') {
      try {
        const finished = await parserApi.finishSearchAccess(accessToken);
        if (finished?.status) updateAccessUi(finished.status);
      } catch (_error) {
        // Помилка оновлення лічильника не повинна приховувати вже зібрані результати.
      }
    }
    state.parsing = false;
    state.cancelRequested = false;
    state.batch = { index: 0, total: 0, query: '' };
    setControlsBusy(false);
    if (pendingStore) {
      const nextStore = pendingStore;
      pendingStore = null;
      applyStore(nextStore);
    }
  }
}

async function restoreRecovery() {
  const saved = await parserApi.getRecovery?.();
  if (!saved?.products?.length || state.parsing) return;
  const store = storeButtons.some((button) => button.dataset.store === saved.store)
    ? saved.store
    : 'eva';
  applyStore(store);
  const query = String(saved.query || saved.brand || '').trim();
  state.queryByStore[store] = query;
  brandInput.value = query;
  state.products = saved.products;
  state.capture = { source: 'recovery', query, capturedAt: saved.updatedAt || '', options: saved.options || {}, complete: false, sourceCount: saved.products.length };
  state.brand = String(saved.brand || query);
  state.detailedMode = Boolean(saved.options?.includeVariants || saved.options?.includeSellers || saved.options?.includeBarcodes);
  state.variantMode = Boolean(saved.options?.includeVariants);
  state.sellerMode = Boolean(saved.options?.includeSellers);
  state.barcodeMode = Boolean(saved.options?.includeBarcodes);
  variantsCheckbox.checked = Boolean(saved.options?.includeVariants);
  sellersCheckbox.checked = Boolean(saved.options?.includeSellers);
  barcodesCheckbox.checked = Boolean(saved.options?.includeBarcodes);
  renderProducts();
  const brands = batchUtils.splitBrandQueries(query);
  updateResultMeta(Math.max(1, brands.length), Math.max(1, brands.length));
  setStatus(
    `Відновлено автозбереження: ${formatProductCount(state.products.length, state.store)}. Їх можна експортувати в Excel.`,
    'warning',
  );
}

function renderProducts() {
  tableBody.replaceChildren();
  const fragment = document.createDocumentFragment();
  const visibleProducts = getVisibleProducts();
  const hasPromo = state.products.some((product) => product.promoPrice || product.promotionCondition);
  const hasVariants = state.products.some((product) => product.variant);
  const hasSellers = state.products.some((product) => product.seller);
  const hasBarcodes = state.barcodeMode || state.products.some((product) => product.barcode);
  const hasComparison = Boolean(state.comparison && !state.comparison.baseline);
  promoHeaders.forEach((header) => { header.hidden = !hasPromo; });
  variantHeader.hidden = !hasVariants;
  sellerHeader.hidden = !hasSellers;
  barcodeHeader.hidden = !hasBarcodes;
  comparisonHeader.hidden = !hasComparison;
  resultChangeFilter.hidden = !hasComparison;
  visibleProducts.forEach((product) => {
    const discount = resultViewUtils.productDiscount(product);
    const row = document.createElement('tr');
    row.append(
      cellWithLink(product.name, product.url),
      textCell(product.brand || state.brand),
    );
    if (typeof parserApi?.getProductPriceHistory === 'function') {
      const historyButton = document.createElement('button');
      historyButton.type = 'button';
      historyButton.className = 'product-history-button';
      historyButton.textContent = 'Історія ціни';
      historyButton.disabled = state.parsing;
      historyButton.addEventListener('click', () => showProductPriceHistory(product));
      row.firstElementChild.appendChild(historyButton);
    }
    if (hasBarcodes) row.append(textCell(product.barcode));
    if (hasVariants) row.append(textCell(product.variant));
    if (hasSellers) row.append(textCell(product.seller));
    if (hasComparison) row.append(comparisonCell(product));
    row.append(
      priceCell(product.priceWithDiscount, product.onSale ? 'sale-price' : ''),
      priceCell(product.priceWithoutDiscount),
      priceCell(discount?.amount, discount ? 'saving-price' : ''),
      textCell(discount ? formatPercent(discount.percent) : '', discount ? 'discount-percent' : ''),
    );
    if (hasPromo) {
      row.append(
        priceCell(product.promoPrice, 'promo-price'),
        textCell(product.promotionCondition),
      );
    }
    fragment.appendChild(row);
  });
  tableBody.appendChild(fragment);
  const hasProducts = state.products.length > 0;
  resultTools.hidden = !hasProducts;
  resultSummary.hidden = !hasProducts;
  tableWrap.hidden = !visibleProducts.length;
  emptyState.hidden = hasProducts;
  noFilterResults.hidden = !hasProducts || visibleProducts.length > 0;
  clearResultFilterButton.disabled = !resultFilter.value;
  resultVisibleCount.textContent = visibleProducts.length === state.products.length
    ? `${state.products.length} ${ukPlural(state.products.length, 'рядок', 'рядки', 'рядків')}`
    : `Показано ${visibleProducts.length} із ${state.products.length}`;
  const summary = resultViewUtils.summarizeProducts(visibleProducts);
  summaryTotal.textContent = String(summary.total);
  summaryDiscounted.textContent = String(summary.discountedCount);
  summaryCheapest.textContent = summary.cheapestPrice === null ? '—' : formatPrice(summary.cheapestPrice);
  summaryLargestDiscount.textContent = summary.largestDiscountPercent === null
    ? '—'
    : formatPercent(summary.largestDiscountPercent);
  copyResultsButton.disabled = visibleProducts.length === 0;
  updateResultExportState(visibleProducts.length);
  renderComparisonSummary();
  captureNotice.hidden = !state.capture || state.capture.source === 'live';
  if (!captureNotice.hidden) {
    captureNotice.textContent = state.capture.source === 'archive'
      ? `Архів від ${formatComparisonDate(state.capture.capturedAt)} — ціни й наявність не перевірялися сьогодні.${state.capture.truncated ? ` Збережено ${state.products.length} із ${state.capture.sourceCount} рядків через ліміт архіву.` : ''}`
      : 'Відновлений частковий результат — це не нова повна перевірка.';
  }
}

function getVisibleProducts() {
  return resultViewUtils.filterAndSortProducts(
    state.products,
    resultFilter.value,
    resultSort.value,
    resultChangeFilter.value,
    resultSaleFilter.value,
    resultMinPrice.value,
    resultMaxPrice.value,
  );
}

function updateResultExportState(visibleCount) {
  const exportCount = exportVisibleOnlyCheckbox.checked ? visibleCount : state.products.length;
  exportButton.disabled = exportCount === 0;
}

function cellWithLink(text, href) {
  const cell = document.createElement('td');
  const link = document.createElement('a');
  link.textContent = text || 'Без назви';
  link.href = href || '#';
  link.target = '_blank';
  link.rel = 'noreferrer';
  cell.appendChild(link);
  return cell;
}

function comparisonCell(product) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'comparison-status';
  badge.dataset.status = product.comparisonStatus || 'unchanged';
  const difference = Number(product.priceDifference);
  const hasDifference = product.priceDifference !== '' && Number.isFinite(difference) && Math.abs(difference) >= 0.005;
  badge.textContent = hasDifference
    ? `${product.comparisonLabel} ${difference > 0 ? '+' : '−'}${formatPrice(Math.abs(difference))}`
    : product.comparisonLabel || 'Без змін';
  if (product.previousPrice !== '' && product.previousPrice !== null && product.previousPrice !== undefined) {
    badge.title = `Попередня ціна: ${formatPrice(product.previousPrice)}`;
  }
  cell.appendChild(badge);
  return cell;
}

function renderComparisonSummary() {
  const comparison = state.comparison;
  comparisonCounts.replaceChildren();
  missingProductsList.replaceChildren();
  if (!comparison) {
    comparisonSummary.hidden = true;
    return;
  }

  comparisonSummary.hidden = false;
  if (comparison.baseline) {
    comparisonTitle.textContent = 'Перший знімок цього пошуку збережено';
    comparisonCaption.textContent = 'Під час наступного повного пошуку програма покаже нові товари та зміни цін.';
    missingProducts.hidden = true;
    return;
  }

  comparisonTitle.textContent = comparison.source === 'archive'
    ? `Архів: ${formatComparisonDate(comparison.previousCapturedAt)} → ${formatComparisonDate(comparison.comparedCapturedAt)}`
    : `Порівняння з ${formatComparisonDate(comparison.previousCapturedAt)}`;
  comparisonCaption.textContent = comparison.source === 'archive'
    ? 'Порівняння двох збережених перевірок. Це не поточні ціни чи залишки; база наступного нового пошуку не змінена. «Зник» означає лише відсутність у пізнішій видачі.'
    : 'Поточний успішний результат автоматично збережено як основу для наступного порівняння.';
  const labels = {
    new: 'Нові',
    cheaper: 'Подешевшали',
    expensive: 'Подорожчали',
    unchanged: 'Без змін',
    missing: 'Зникли з видачі',
  };
  for (const status of ['new', 'cheaper', 'expensive', 'unchanged', 'missing']) {
    const pill = document.createElement('span');
    pill.className = 'comparison-pill';
    pill.dataset.status = status;
    pill.textContent = `${labels[status]}: ${comparison.summary?.[status] || 0}`;
    comparisonCounts.appendChild(pill);
  }

  const missing = Array.isArray(comparison.missing) ? comparison.missing : [];
  missingProducts.hidden = !missing.length;
  if (!missing.length) return;
  missingProductsTitle.textContent = `Окремо: ${formatMissingCount(missing.length)}`;
  const shown = missing.slice(0, 100);
  shown.forEach((product) => {
    const row = document.createElement('div');
    row.className = 'missing-product';
    const link = document.createElement('a');
    link.textContent = [product.name, product.variant, product.seller].filter(Boolean).join(' · ') || 'Без назви';
    link.href = product.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer';
    const price = document.createElement('span');
    price.textContent = product.previousPrice === '' ? 'ціна невідома' : `було ${formatPrice(product.previousPrice)}`;
    row.append(link, price);
    missingProductsList.appendChild(row);
  });
  if (missing.length > shown.length) {
    const more = document.createElement('div');
    more.className = 'history-empty';
    more.textContent = `Та ще ${missing.length - shown.length}. Повний список буде в Excel.`;
    missingProductsList.appendChild(more);
  }
}

function formatComparisonDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'попереднім пошуком';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function formatMissingCount(value) {
  return `${value} ${ukPlural(value, 'товар зник', 'товари зникли', 'товарів зникли')} з поточної видачі`;
}

function textCell(value, className = '') {
  const cell = document.createElement('td');
  cell.className = className;
  cell.textContent = value || '—';
  return cell;
}

function priceCell(value, className = '') {
  const cell = document.createElement('td');
  cell.className = `price-cell ${className}`.trim();
  const hasPrice = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  cell.textContent = hasPrice ? formatPrice(value) : '—';
  return cell;
}

function formatPrice(value) {
  return `${new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: Number(value) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Number(value))} ₴`;
}

function formatPercent(value) {
  return `${new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: Number(value) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Number(value))}%`;
}

async function copyVisibleResults() {
  const products = getVisibleProducts();
  if (!products.length || !parserApi?.copyText || !resultViewUtils?.productsToTsv) return;
  try {
    await parserApi.copyText(resultViewUtils.productsToTsv(products, storeName(state.store)));
    setStatus(`Скопійовано: ${products.length} ${ukPlural(products.length, 'рядок', 'рядки', 'рядків')}. Можна вставляти в Excel.`, 'success');
  } catch (error) {
    setStatus('Не вдалося скопіювати таблицю.', 'error');
  }
}

async function exportExcel() {
  if (!parserAvailable) return showLaunchHint();
  const products = exportVisibleOnlyCheckbox.checked ? getVisibleProducts() : state.products;
  if (!products.length) return;
  exportButton.disabled = true;
  setStatus('Готую файл Excel…', 'loading');
  try {
    const filePath = await parserApi.exportExcel({
      store: state.store,
      brand: state.brand,
      products,
      comparison: state.comparison,
      options: { includeBarcodes: state.barcodeMode },
      capture: state.capture,
      filters: {
        visibleOnly: exportVisibleOnlyCheckbox.checked,
        query: exportVisibleOnlyCheckbox.checked ? resultFilter.value : '',
        sale: exportVisibleOnlyCheckbox.checked ? resultSaleFilter.value : 'all',
        minPrice: exportVisibleOnlyCheckbox.checked ? resultMinPrice.value : '',
        maxPrice: exportVisibleOnlyCheckbox.checked ? resultMaxPrice.value : '',
      },
    });
    setStatus(filePath ? `Excel збережено: ${filePath}` : 'Збереження скасовано', filePath ? 'success' : 'idle');
  } catch (error) {
    setStatus(batchUtils.cleanParserError(error), 'error');
  } finally {
    updateResultExportState(getVisibleProducts().length);
  }
}

function clearResults() {
  state.products = [];
  state.brand = '';
  tableBody.replaceChildren();
  promoHeaders.forEach((header) => { header.hidden = true; });
  variantHeader.hidden = true;
  sellerHeader.hidden = true;
  barcodeHeader.hidden = true;
  comparisonHeader.hidden = true;
  state.comparison = null;
  state.capture = null;
  captureNotice.hidden = true;
  tableWrap.hidden = true;
  resultTools.hidden = true;
  resultSummary.hidden = true;
  emptyState.hidden = false;
  noFilterResults.hidden = true;
  exportButton.disabled = true;
  resultFilter.value = '';
  resultSort.value = 'original';
  resultChangeFilter.value = 'all';
  resultChangeFilter.hidden = true;
  resultSaleFilter.value = 'all';
  resultMinPrice.value = '';
  resultMaxPrice.value = '';
  exportVisibleOnlyCheckbox.checked = true;
  resultVisibleCount.textContent = '';
  summaryTotal.textContent = '0';
  summaryDiscounted.textContent = '0';
  summaryCheapest.textContent = '—';
  summaryLargestDiscount.textContent = '—';
  copyResultsButton.disabled = true;
  clearResultFilterButton.disabled = true;
  resultMeta.textContent = '';
  comparisonSummary.hidden = true;
  comparisonCounts.replaceChildren();
  missingProductsList.replaceChildren();
}

function appendBrand(current, brand) {
  const brands = batchUtils.splitBrandQueries(`${current || ''},${brand || ''}`);
  return brands.join(', ');
}

function updateResultMeta(processed, total) {
  if (!state.products.length) {
    resultMeta.textContent = '';
    return;
  }
  const unit = state.store === 'rozetka'
    ? ukPlural(state.products.length, 'пропозиція', 'пропозиції', 'пропозицій')
    : ukPlural(state.products.length, 'товар', 'товари', 'товарів');
  const modes = [];
  if (state.variantMode) modes.push('з варіантами');
  if (state.sellerMode) modes.push('з продавцями');
  if (state.barcodeMode) modes.push('зі штрихкодами');
  const detail = modes.length ? ` · ${modes.join(' · ')}` : '';
  resultMeta.textContent = total > 1
    ? `${storeName(state.store)} · ${processed} із ${total} марок · ${state.products.length} ${unit}${detail}`
    : `${storeName(state.store)} · ${state.brand} · ${state.products.length} ${unit}${detail}`;
  if (state.capture?.source === 'archive') resultMeta.textContent += ` · Архів ${formatComparisonDate(state.capture.capturedAt)}`;
}

function setControlsBusy(busy) {
  showArchiveButton.disabled = busy;
  showChangeReportButton.disabled = busy;
  document.querySelectorAll('.product-history-button').forEach((button) => { button.disabled = busy; });
  parseButton.hidden = busy;
  parseButton.disabled = busy || isAccessBlocked();
  cancelButton.hidden = !busy;
  cancelButton.disabled = false;
  brandInput.disabled = busy;
  variantsCheckbox.disabled = busy;
  sellersCheckbox.disabled = busy;
  barcodesCheckbox.disabled = busy;
  savedListSelect.disabled = busy;
  savedListName.disabled = busy;
  saveCurrentListButton.disabled = busy;
  updateSavedListButtons();
  renderSearchHistory();
}

function setStatus(message, type) {
  statusElement.textContent = message;
  statusElement.dataset.type = type;
  statusSpinner.hidden = type !== 'loading';
}

function storeName(store) {
  return { eva: 'EVA', varus: 'VARUS', makeup: 'MAKEUP', aurora: 'Аврора', notino: 'Notino', rozetka: 'Rozetka' }[store] || store;
}

function showLaunchHint() {
  setStatus('Це файл програми. Запустіть Price Monitor через інсталятор або готовий .exe з папки release.', 'error');
}
