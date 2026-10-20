const STORE_LABELS = {
  eva: 'EVA',
  varus: 'VARUS',
  makeup: 'MAKEUP',
  aurora: 'Аврора',
  notino: 'Notino',
  rozetka: 'Rozetka',
};
const STORE_IDS = Object.keys(STORE_LABELS);
const EVENT_LABELS = {
  activated: 'Активація',
  activation_pending: 'Очікує підтвердження',
  checked: 'Перевірка ліцензії',
  activation_rejected: 'Відхилена активація',
  license_blocked: 'Заблокована ліцензія',
  telegram_notice: 'Telegram-сповіщення',
  admin_license_created: 'Власник створив клієнта',
  admin_license_updated: 'Власник змінив ліцензію',
  admin_activation_code_rotated: 'Власник оновив код активації',
  admin_device_removed: 'Власник відв’язав пристрій',
  rate_limited: 'Забагато запитів',
  server_error: 'Помилка сервера',
};

const tokenInput = document.getElementById('admin-token');
const tokenRow = document.querySelector('.token-row');
const notice = document.getElementById('notice');
const licenses = document.getElementById('licenses');
const events = document.getElementById('events');
const attentionSection = document.getElementById('attention-section');
const attention = document.getElementById('attention');
const createForm = document.getElementById('create-license');
const createStores = document.getElementById('create-stores');
const refreshButton = document.getElementById('refresh');
const serverStatus = document.getElementById('server-status');
const publishReleaseForm = document.getElementById('publish-release');
const releaseSource = document.getElementById('release-source');
const selectReleaseButton = document.getElementById('select-release');
const releases = document.getElementById('releases');
const telegramForm = document.getElementById('telegram-settings');
const telegramStatus = document.getElementById('telegram-status');
const testTelegramButton = document.getElementById('test-telegram');
let ownerMode = 'browser';

renderStoreCheckboxes(createStores, STORE_IDS, 'create-store');
setDefaultPaidUntil();

refreshButton.addEventListener('click', () => refresh().catch(showError));
createForm.addEventListener('submit', (event) => createLicense(event).catch(showError));
licenses.addEventListener('click', (event) => handleLicenseAction(event).catch(showError));
attention.addEventListener('click', focusAttentionClient);
selectReleaseButton.addEventListener('click', () => selectReleaseInstaller().catch(showError));
publishReleaseForm.addEventListener('submit', (event) => publishRelease(event).catch(showError));
telegramForm.addEventListener('submit', (event) => saveTelegram(event).catch(showError));
testTelegramButton.addEventListener('click', () => testTelegram().catch(showError));
initializeOwner().catch(showError);
setInterval(() => {
  if (!document.activeElement?.matches('input,select,textarea')) refresh({ quiet: true }).catch(() => {});
}, 5000);

async function initializeOwner() {
  const environment = await window.priceMonitorOwner?.environment?.().catch(() => null);
  if (environment?.secureProxy) {
    ownerMode = environment.mode || 'native';
    tokenRow.hidden = true;
  } else {
    initializeToken();
  }
  if (ownerMode === 'cloud') {
    document.getElementById('owner-title').textContent = 'Хмарне керування Price Monitor';
    document.getElementById('owner-description').textContent = 'Ліцензії та пристрої зберігаються у Cloudflare. Адміністративний токен залишається на цьому комп’ютері.';
    document.getElementById('updates-section').hidden = true;
    document.getElementById('telegram-section').hidden = true;
  }
  await refresh();
}

function initializeToken() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get('token') || sessionStorage.getItem('price-monitor-admin-token') || '';
  tokenInput.value = token;
  if (fragment.get('token')) {
    sessionStorage.setItem('price-monitor-admin-token', token);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    tokenRow.hidden = true;
  }
  tokenInput.addEventListener('change', () => {
    sessionStorage.setItem('price-monitor-admin-token', tokenInput.value.trim());
  });
}

async function api(path, options = {}) {
  if (window.priceMonitorOwner?.apiRequest) {
    const result = await window.priceMonitorOwner.apiRequest({
      path,
      method: options.method || 'GET',
      body: options.body || '',
    });
    if (!result?.ok) throw apiError(result?.body, result?.status || 0);
    return result.body || {};
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-admin-token': tokenInput.value.trim(),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(body, response.status);
  return body;
}

async function createLicense(event) {
  event.preventDefault();
  const fields = new FormData(createForm);
  const stores = selectedStoreIds(createStores);
  if (!stores.length) throw new Error('Оберіть хоча б один магазин.');
  const body = await api('/admin/api/licenses', {
    method: 'POST',
    body: JSON.stringify({
      customerName: fields.get('customerName'),
      paidUntil: localEndOfDay(fields.get('paidUntil')),
      maxDevices: Number(fields.get('maxDevices')),
      leaseDays: Number(fields.get('leaseDays')),
      status: fields.get('status'),
      stores,
    }),
  });
  const copied = await copyActivationCode(body.activationCode);
  showActivationCode(body.activationCode, { copied, regenerated: false, license: body.license });
  createForm.reset();
  createForm.elements.maxDevices.value = 10;
  createForm.elements.leaseDays.value = 14;
  createStores.querySelectorAll('input').forEach((input) => { input.checked = true; });
  setDefaultPaidUntil();
  await refresh();
}

async function refresh({ quiet = false } = {}) {
  if (!quiet) refreshButton.disabled = true;
  try {
    const data = await api('/admin/api/overview');
    renderService(data.service || {});
    renderSummary(data);
    renderAttention(data.licenses || []);
    renderLicenses(data.licenses || []);
    renderEvents(data.events || []);
    renderReleases(data.releases || []);
    renderTelegramSettings(data.settings || {});
    serverStatus.textContent = ownerMode === 'cloud'
      ? `${data.service?.environment === 'production' ? 'Production' : 'Тестовий сервер'} працює · ${new Date().toLocaleTimeString('uk-UA')}`
      : `Сервер працює · клієнтський порт ${data.publicServer?.port || '—'} · ${new Date().toLocaleTimeString('uk-UA')}`;
  } finally {
    if (!quiet) refreshButton.disabled = false;
  }
}

function renderService(service) {
  const environment = String(service.environment || 'unknown');
  const environmentElement = document.getElementById('service-environment');
  environmentElement.textContent = environment === 'production' ? 'PRODUCTION' : environment.toUpperCase();
  environmentElement.className = environment === 'production' ? 'environment-production' : 'environment-staging';
  document.getElementById('service-version').textContent = service.version || '—';
  document.getElementById('service-database').textContent = service.database === 'ready' ? 'Працює' : 'Недоступна';
  document.getElementById('service-recovery').textContent = service.recoveryDays ? `${service.recoveryDays} днів` : '—';
  document.getElementById('service-request').textContent = `Ідентифікатор останньої перевірки: ${service.requestId || '—'}`;
}

function apiError(body = {}, status = 0) {
  const code = body?.error || `HTTP ${status}`;
  const suffix = body?.requestId ? ` · запит ${body.requestId}` : '';
  return new Error(`${code}${suffix}`);
}

function renderSummary(data) {
  const licenseItems = data.licenses || [];
  const deviceItems = licenseItems.flatMap((item) => item.devices || []).filter((item) => item.status !== 'removed');
  document.getElementById('total-licenses').textContent = licenseItems.length;
  document.getElementById('active-licenses').textContent = licenseItems.filter((item) => item.status === 'active').length;
  document.getElementById('active-devices').textContent = deviceItems.length;
  document.getElementById('event-count').textContent = Number(data.eventCount ?? (data.events || []).length);
}

function renderLicenses(items) {
  if (!items.length) {
    licenses.innerHTML = '<p>Ліцензій ще немає.</p>';
    return;
  }
  licenses.innerHTML = `<div class="client-list">${items.map((item) => {
    const activeDevices = (item.devices || []).filter((device) => device.status !== 'removed');
    const blocked = item.status !== 'active';
    return `<article class="client-card" id="client-${escapeHtml(item.id)}">
      <div class="client-summary">
        <div><strong>${escapeHtml(item.customerName)}</strong><br><code>${escapeHtml(item.id)}</code><br><span class="muted">код активації ···${escapeHtml(item.activationHint || '')}</span></div>
        <div><span class="status-pill ${blocked ? 'is-blocked' : ''}">${escapeHtml(statusLabel(item.status))}</span></div>
        <div><strong>${activeDevices.length}/${Number(item.maxDevices) || 1}</strong><br><span class="muted">підключено пристроїв</span></div>
        <div><strong>${escapeHtml(formatDate(item.paidUntil))}</strong><br><span class="muted">оплачено до</span></div>
      </div>
      <details class="client-actions">
        <summary>Керування клієнтом</summary>
        <div class="client-settings">
          <div><div class="license-rules">
            <label>Оплачено до<input type="date" data-field="paidUntil" data-id="${escapeHtml(item.id)}" value="${escapeHtml(String(item.paidUntil).slice(0, 10))}"></label>
            <label>Дозволено комп’ютерів<input type="number" min="1" max="10000" data-field="maxDevices" data-id="${escapeHtml(item.id)}" value="${Number(item.maxDevices) || 1}"></label>
            <label>Автономних днів<input type="number" min="1" max="90" data-field="leaseDays" data-id="${escapeHtml(item.id)}" value="${Number(item.leaseDays) || 14}"></label>
            <div class="license-stores" data-stores-for="${escapeHtml(item.id)}">${storeCheckboxMarkup(item.stores || [], `license-${item.id}`)}</div>
          </div><div class="client-buttons">
            <button class="primary" data-action="save" data-id="${escapeHtml(item.id)}">Зберегти зміни</button>
            <button data-action="new-code" data-id="${escapeHtml(item.id)}">Випустити новий код</button>
            <button data-action="status" data-status="active" data-id="${escapeHtml(item.id)}">Зробити активною</button>
            <button data-action="status" data-status="suspended" data-id="${escapeHtml(item.id)}">Призупинити</button>
            <button class="danger" data-action="status" data-status="revoked" data-id="${escapeHtml(item.id)}">Заблокувати</button>
          </div></div>
          <div><strong>Підключені пристрої</strong>${renderDevices(item)}</div>
        </div>
      </details>
    </article>`;
  }).join('')}</div>`;
}

function renderDevices(license) {
  const active = (license.devices || []).filter((device) => device.status !== 'removed');
  if (!active.length) return '<span class="muted">Немає</span>';
  return active.map((device) => `<div class="device"><span><strong>${escapeHtml(device.label || 'Комп’ютер без назви')}</strong><br><code>${escapeHtml(shortCode(device.deviceId))}</code><br><span class="muted">версія ${escapeHtml(device.appVersion || 'невідома')} · перше підключення ${escapeHtml(formatDateTime(device.firstSeenAt))} · останній зв’язок ${escapeHtml(formatDateTime(device.lastSeenAt))}</span></span><button class="danger" data-action="remove-device" data-id="${escapeHtml(license.id)}" data-device="${escapeHtml(device.deviceId)}">Відв’язати</button></div>`).join('');
}

function renderAttention(items) {
  const now = Date.now();
  const messages = [];
  for (const license of items) {
    const devices = (license.devices || []).filter((device) => device.status !== 'removed');
    for (const device of devices) {
      const firstSeen = Date.parse(device.firstSeenAt || '');
      if (license.status === 'active' && Number.isFinite(firstSeen) && now - firstSeen <= 48 * 60 * 60 * 1000) {
        messages.push({ kind: 'new', license, text: `Новий пристрій ${device.label || shortCode(device.deviceId)} підключено до «${license.customerName}».` });
      }
    }
    const paidUntil = Date.parse(license.paidUntil || '');
    const days = Number.isFinite(paidUntil) ? Math.ceil((paidUntil - now) / (24 * 60 * 60 * 1000)) : null;
    if (license.status === 'active' && days !== null && days >= 0 && days <= 14) {
      messages.push({ kind: 'warning', license, text: `Оплата «${license.customerName}» завершується ${formatDate(license.paidUntil)}.` });
    }
    if (license.status === 'pending') messages.push({ kind: 'warning', license, text: `Ліцензія «${license.customerName}» очікує рішення.` });
  }
  attentionSection.hidden = messages.length === 0;
  attention.innerHTML = messages.length
    ? messages.map((item) => `<div class="attention-item ${item.kind === 'new' ? 'is-new' : ''}"><span>${escapeHtml(item.text)}</span><button type="button" data-attention-license="${escapeHtml(item.license.id)}">Відкрити клієнта</button></div>`).join('')
    : '';
}

function focusAttentionClient(event) {
  const button = event.target.closest('[data-attention-license]');
  if (!button) return;
  const card = document.getElementById(`client-${button.dataset.attentionLicense}`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.querySelector('details')?.setAttribute('open', '');
}

function renderEvents(items) {
  if (!items.length) {
    events.innerHTML = '<p>Подій ще немає.</p>';
    return;
  }
  events.innerHTML = `<table><thead><tr><th>Час</th><th>Подія</th><th>Ліцензія</th><th>Пристрій</th></tr></thead><tbody>${items.slice(0, 100).map((item) => `<tr><td>${escapeHtml(formatDateTime(item.occurredAt))}</td><td>${escapeHtml(EVENT_LABELS[item.type] || item.type)}</td><td><code>${escapeHtml(item.licenseId || '—')}</code></td><td><code>${escapeHtml(shortCode(item.deviceId) || '—')}</code></td></tr>`).join('')}</tbody></table>`;
}

async function handleLicenseAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  button.disabled = true;
  const id = button.dataset.id;
  try {
    if (button.dataset.action === 'save') {
      const field = (name) => document.querySelector(`[data-field="${name}"][data-id="${CSS.escape(id)}"]`);
      const storeContainer = document.querySelector(`[data-stores-for="${CSS.escape(id)}"]`);
      const stores = selectedStoreIds(storeContainer);
      if (!stores.length) throw new Error('Оберіть хоча б один магазин.');
      await api(`/admin/api/licenses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          paidUntil: localEndOfDay(field('paidUntil').value),
          maxDevices: Number(field('maxDevices').value),
          leaseDays: Number(field('leaseDays').value),
          stores,
        }),
      });
      showNotice('Налаштування ліцензії збережено. Клієнт отримає їх під час наступної онлайн-перевірки.');
    } else if (button.dataset.action === 'new-code') {
      const confirmed = window.confirm('Випустити новий код? Попередній код цієї ліцензії одразу перестане працювати.');
      if (!confirmed) return;
      const body = await api(`/admin/api/licenses/${encodeURIComponent(id)}/activation-code`, { method: 'POST' });
      const copied = await copyActivationCode(body.activationCode);
      showActivationCode(body.activationCode, { copied, regenerated: true, license: body.license });
    } else if (button.dataset.action === 'status') {
      await api(`/admin/api/licenses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
    } else if (button.dataset.action === 'remove-device') {
      await api(`/admin/api/licenses/${encodeURIComponent(id)}/devices/${button.dataset.device}`, { method: 'DELETE' });
    }
    await refresh();
  } finally {
    button.disabled = false;
  }
}

function renderStoreCheckboxes(container, selected, prefix) {
  container.innerHTML = `<strong>Доступні магазини:</strong>${storeCheckboxMarkup(selected, prefix)}`;
}

function storeCheckboxMarkup(selected, prefix) {
  const allowed = new Set(selected);
  return STORE_IDS.map((id) => `<label><input type="checkbox" name="stores" value="${id}" id="${escapeHtml(prefix)}-${id}" ${allowed.has(id) ? 'checked' : ''}>${escapeHtml(STORE_LABELS[id])}</label>`).join('');
}

function selectedStoreIds(container) {
  return [...container.querySelectorAll('input[name="stores"]:checked')].map((input) => input.value);
}

function localEndOfDay(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) throw new Error('Оберіть правильну дату.');
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function setDefaultPaidUntil() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  createForm.elements.paidUntil.value = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function statusLabel(value) {
  return { pending: 'Очікує підтвердження', active: 'Активна', suspended: 'Призупинена', revoked: 'Заблокована' }[value] || value;
}

async function selectReleaseInstaller() {
  if (!window.priceMonitorOwner?.selectInstaller) throw new Error('Вибір файла доступний лише у встановленій серверній програмі.');
  const result = await window.priceMonitorOwner.selectInstaller();
  if (!result.canceled) releaseSource.value = result.filePath;
}

async function publishRelease(event) {
  event.preventDefault();
  const fields = new FormData(publishReleaseForm);
  const body = await api('/admin/api/releases', {
    method: 'POST',
    body: JSON.stringify({
      version: fields.get('version'), channel: fields.get('channel'), sourcePath: fields.get('sourcePath'),
      required: fields.get('required') === 'true', notes: fields.get('notes'),
    }),
  });
  showNotice(`Оновлення ${body.release.version} підписано й опубліковано для каналу ${body.release.channel}.`);
  publishReleaseForm.reset();
  publishReleaseForm.elements.channel.value = 'licensed';
  await refresh();
}

function renderReleases(items) {
  if (!items.length) { releases.innerHTML = '<p>Оновлень ще немає.</p>'; return; }
  releases.innerHTML = `<table><thead><tr><th>Версія</th><th>Канал</th><th>Файл</th><th>Опубліковано</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.version)}</strong>${item.required ? '<br><span class="muted">обов’язкове</span>' : ''}</td><td>${escapeHtml(item.channel)}</td><td>${escapeHtml(item.fileName)}<br><code>${escapeHtml(String(item.sha256 || '').slice(0, 16))}…</code></td><td>${escapeHtml(formatDateTime(item.publishedAt))}</td></tr>`).join('')}</tbody></table>`;
}

function renderTelegramSettings(settings) {
  telegramForm.elements.enabled.value = settings.telegramEnabled ? 'true' : 'false';
  telegramStatus.textContent = settings.telegramConfigured
    ? `Налаштовано · Chat ID ${settings.telegramChatId}. Токен приховано.`
    : 'Ще не налаштовано.';
}

async function saveTelegram(event) {
  event.preventDefault();
  const fields = new FormData(telegramForm);
  await api('/admin/api/settings/telegram', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: fields.get('enabled') === 'true', botToken: fields.get('botToken'), chatId: fields.get('chatId') }),
  });
  telegramForm.elements.botToken.value = '';
  telegramForm.elements.chatId.value = '';
  showNotice('Налаштування Telegram збережено.');
  await refresh();
}

async function testTelegram() {
  testTelegramButton.disabled = true;
  try {
    const result = await api('/admin/api/settings/telegram/test', { method: 'POST', body: '{}' });
    showNotice(result.sent ? 'Тестове повідомлення надіслано.' : 'Telegram ще не налаштовано або вимкнено.');
  } finally { testTelegramButton.disabled = false; }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('uk-UA');
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('uk-UA');
}

function shortCode(deviceId) {
  return String(deviceId || '').slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join('-') || '';
}

function showNotice(message) {
  notice.hidden = false;
  notice.classList.remove('error');
  notice.textContent = message;
}

function showActivationCode(code, { copied = false, regenerated = false, license = {} } = {}) {
  notice.hidden = false;
  notice.classList.remove('error');
  notice.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = regenerated ? 'Новий код активації створено.' : 'Код активації створено.';
  const description = document.createElement('span');
  description.textContent = ` Клієнт: ${license.customerName || 'не вказано'}. Код показується лише зараз.`;
  const codeElement = document.createElement('code');
  codeElement.textContent = String(code || '');
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = copied ? 'Скопійовано' : 'Скопіювати код';
  const copyStatus = document.createElement('span');
  copyStatus.className = 'muted';
  copyStatus.textContent = copied ? ' Код уже у буфері обміну.' : ' Натисніть кнопку перед переходом до клієнта.';
  copyButton.addEventListener('click', async () => {
    const success = await copyActivationCode(code);
    copyButton.textContent = success ? 'Скопійовано' : 'Не вдалося скопіювати';
    copyStatus.textContent = success ? ' Код у буфері обміну.' : ' Виділіть код вище та скопіюйте вручну.';
  });
  const message = activationMessage(code, license);
  const messageLabel = document.createElement('strong');
  messageLabel.textContent = 'Готове повідомлення клієнту:';
  const messageBox = document.createElement('textarea');
  messageBox.readOnly = true;
  messageBox.value = message;
  const copyMessageButton = document.createElement('button');
  copyMessageButton.type = 'button';
  copyMessageButton.textContent = 'Скопіювати код та інструкцію';
  copyMessageButton.addEventListener('click', async () => {
    const success = await copyActivationCode(message);
    copyMessageButton.textContent = success ? 'Повідомлення скопійовано' : 'Не вдалося скопіювати';
  });
  const packageBlock = document.createElement('div');
  packageBlock.className = 'activation-package';
  packageBlock.append(messageLabel, messageBox, copyMessageButton);
  notice.append(title, description, codeElement, copyButton, copyStatus, packageBlock);
}

function activationMessage(code, license = {}) {
  const customer = license.customerName ? ` для «${license.customerName}»` : '';
  return `Встановіть Price Monitor та відкрийте блок активації${customer}.\n\nВставте цей довгий код у поле «Код активації»:\n${String(code || '')}\n\nКороткий код пристрою вводити не потрібно. Після успішної активації програма збереже ліцензію на цьому комп’ютері.`;
}

async function copyActivationCode(code) {
  try {
    const result = await window.priceMonitorOwner?.copyText?.(code);
    if (result?.copied) return true;
  } catch (_error) {
    // Нижче лишається браузерний запасний варіант.
  }
  try {
    await navigator.clipboard?.writeText(code);
    return true;
  } catch (_error) {
    return false;
  }
}

function showError(error) {
  serverStatus.textContent = 'Немає зв’язку з сервером';
  notice.hidden = false;
  notice.classList.add('error');
  notice.textContent = `Помилка: ${error.message}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}
