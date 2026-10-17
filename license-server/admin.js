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
};

const tokenInput = document.getElementById('admin-token');
const tokenRow = document.querySelector('.token-row');
const notice = document.getElementById('notice');
const licenses = document.getElementById('licenses');
const events = document.getElementById('events');
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
    if (!result?.ok) throw new Error(result?.body?.error || `HTTP ${result?.status || 0}`);
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
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
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
  showActivationCode(body.activationCode, { copied, regenerated: false });
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
    renderSummary(data);
    renderLicenses(data.licenses || []);
    renderEvents(data.events || []);
    renderReleases(data.releases || []);
    renderTelegramSettings(data.settings || {});
    serverStatus.textContent = ownerMode === 'cloud'
      ? `Хмарний сервер працює · ${new Date().toLocaleTimeString('uk-UA')}`
      : `Сервер працює · клієнтський порт ${data.publicServer?.port || '—'} · ${new Date().toLocaleTimeString('uk-UA')}`;
  } finally {
    if (!quiet) refreshButton.disabled = false;
  }
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
  licenses.innerHTML = `<table><thead><tr><th>Клієнт</th><th>Статус</th><th>Правила й магазини</th><th>Пристрої</th><th>Дії</th></tr></thead><tbody>${items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.customerName)}</strong><br><code>${escapeHtml(item.id)}</code><br><span class="muted">код ···${escapeHtml(item.activationHint || '')}</span></td>
      <td>${escapeHtml(statusLabel(item.status))}<br><span class="muted">до ${formatDate(item.paidUntil)}</span></td>
      <td><div class="license-rules">
        <label>Оплачено до<input type="date" data-field="paidUntil" data-id="${escapeHtml(item.id)}" value="${escapeHtml(String(item.paidUntil).slice(0, 10))}"></label>
        <label>Комп’ютерів<input type="number" min="1" max="10000" data-field="maxDevices" data-id="${escapeHtml(item.id)}" value="${Number(item.maxDevices) || 1}"></label>
        <label>Автономних днів<input type="number" min="1" max="90" data-field="leaseDays" data-id="${escapeHtml(item.id)}" value="${Number(item.leaseDays) || 14}"></label>
        <div class="license-stores" data-stores-for="${escapeHtml(item.id)}">${storeCheckboxMarkup(item.stores || [], `license-${item.id}`)}</div>
      </div></td>
      <td>${renderDevices(item)}</td>
      <td>
        <button data-action="save" data-id="${escapeHtml(item.id)}">Зберегти правила</button>
        <button data-action="new-code" data-id="${escapeHtml(item.id)}">Новий код</button>
        <button data-action="status" data-status="active" data-id="${escapeHtml(item.id)}">Підтвердити</button>
        <button data-action="status" data-status="suspended" data-id="${escapeHtml(item.id)}">Призупинити</button>
        <button class="danger" data-action="status" data-status="revoked" data-id="${escapeHtml(item.id)}">Заблокувати</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function renderDevices(license) {
  const active = (license.devices || []).filter((device) => device.status !== 'removed');
  if (!active.length) return '<span class="muted">Немає</span>';
  return active.map((device) => `<div class="device"><span><code>${escapeHtml(shortCode(device.deviceId))}</code><br><span class="muted">${escapeHtml(device.appVersion || 'версія невідома')}</span></span><button class="danger" data-action="remove-device" data-id="${escapeHtml(license.id)}" data-device="${escapeHtml(device.deviceId)}">Відв’язати</button></div>`).join('');
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
      showActivationCode(body.activationCode, { copied, regenerated: true });
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

function showActivationCode(code, { copied = false, regenerated = false } = {}) {
  notice.hidden = false;
  notice.classList.remove('error');
  notice.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = regenerated ? 'Новий код активації створено.' : 'Код активації створено.';
  const description = document.createElement('span');
  description.textContent = ' Він показується лише зараз.';
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
  notice.append(title, description, codeElement, copyButton, copyStatus);
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
