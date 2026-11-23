const STORE_ORDER = ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'];

const HEADER_ALIASES = {
  name: ['назва проєкту', 'назва проекту', 'проект', 'проєкт', 'project', 'name'],
  query: ['торгові марки', 'торговые марки', 'марки', 'бренди', 'бренды', 'запит', 'запрос', 'query', 'brands'],
  stores: ['магазини', 'магазины', 'магазин', 'stores', 'store'],
  mode: ['режим', 'mode'],
  schedule: ['запуск', 'розклад', 'расписание', 'schedule'],
  time: ['час', 'время', 'time'],
};

const STORE_ALIASES = new Map([
  ['eva', 'eva'], ['ева', 'eva'], ['єва', 'eva'],
  ['varus', 'varus'], ['варус', 'varus'],
  ['makeup', 'makeup'], ['мейкап', 'makeup'], ['мэйкап', 'makeup'],
  ['aurora', 'aurora'], ['аврора', 'aurora'],
  ['notino', 'notino'], ['нотіно', 'notino'], ['нотино', 'notino'],
  ['rozetka', 'rozetka'], ['розетка', 'rozetka'],
]);

function parseMonitoringProjectRows(rows, options = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const maximumRows = Math.max(1, Math.min(1_000, Number(options.maximumRows) || 200));
  if (!source.length) return result([], [{ row: 1, message: 'Файл порожній.' }], 0);
  const header = Array.isArray(source[0]) ? source[0] : [];
  const columns = mapHeaders(header);
  const missing = ['name', 'query', 'stores'].filter((key) => columns[key] === undefined);
  if (missing.length) {
    const labels = { name: 'Назва проєкту', query: 'Торгові марки', stores: 'Магазини' };
    return result([], [{ row: 1, message: `Немає обов’язкових колонок: ${missing.map((key) => labels[key]).join(', ')}.` }], 0);
  }

  const projects = [];
  const errors = [];
  const seenNames = new Set();
  let dataRows = 0;
  for (let index = 1; index < source.length && dataRows < maximumRows; index += 1) {
    const row = Array.isArray(source[index]) ? source[index] : [];
    if (row.every((cell) => !clean(cell, 1_000))) continue;
    dataRows += 1;
    const number = index + 1;
    const name = cell(row, columns.name, 80);
    const query = cell(row, columns.query, 500);
    const storesValue = cell(row, columns.stores, 500);
    const stores = normalizeStores(storesValue);
    const rowErrors = [];
    if (!name) rowErrors.push('не вказано назву проєкту');
    if (!query) rowErrors.push('не вказано торгові марки');
    if (stores.length < 2) rowErrors.push('потрібно щонайменше два відомі магазини');
    const key = normalize(name);
    if (key && seenNames.has(key)) rowErrors.push('назва проєкту повторюється у файлі');

    const mode = normalizeMode(cell(row, columns.mode, 60));
    const schedule = normalizeSchedule(cell(row, columns.schedule, 60));
    const timeValue = cell(row, columns.time, 30);
    const time = normalizeTime(timeValue);
    if (schedule === 'daily' && timeValue && !time) rowErrors.push('час має бути у форматі ГГ:ХХ');

    if (rowErrors.length) {
      errors.push({ row: number, message: rowErrors.join('; ') });
      continue;
    }
    seenNames.add(key);
    projects.push({
      id: `import-${number}`,
      name,
      query,
      stores,
      mode,
      schedule: { kind: schedule, time: time || '09:00' },
    });
  }
  if (source.slice(1).filter((row) => Array.isArray(row) && row.some((cellValue) => clean(cellValue, 1_000))).length > maximumRows) {
    errors.push({ row: maximumRows + 2, message: `За один раз обробляються перші ${maximumRows} заповнених рядків.` });
  }
  return result(projects, errors, dataRows);
}

function parseDelimitedText(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function spreadsheetRows(value) {
  if (Array.isArray(value?.[0]?.data)) return value[0].data;
  return Array.isArray(value) ? value : [];
}

function mapHeaders(values) {
  const result = {};
  values.forEach((value, index) => {
    const label = normalize(value);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (result[key] === undefined && aliases.includes(label)) result[key] = index;
    }
  });
  return result;
}

function normalizeStores(value) {
  const stores = [];
  const seen = new Set();
  for (const part of String(value || '').split(/[,;|/+\n]+/)) {
    const store = STORE_ALIASES.get(normalize(part));
    if (!store || seen.has(store)) continue;
    seen.add(store);
    stores.push(store);
  }
  return stores.sort((left, right) => STORE_ORDER.indexOf(left) - STORE_ORDER.indexOf(right));
}

function normalizeMode(value) {
  const label = normalize(value);
  return ['детально', 'детальний', 'детальный', 'повний', 'полный', 'detailed', 'full'].includes(label)
    ? 'detailed'
    : 'fast';
}

function normalizeSchedule(value) {
  const label = normalize(value);
  return ['щодня', 'ежедневно', 'daily', 'кожного дня'].includes(label) ? 'daily' : 'manual';
}

function normalizeTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = String(value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  return candidates.sort((left, right) => countOutsideQuotes(line, right) - countOutsideQuotes(line, left))[0];
}

function countOutsideQuotes(value, delimiter) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === delimiter) count += 1;
  }
  return count;
}

function cell(row, index, limit) {
  return index === undefined ? '' : clean(row[index], limit);
}

function clean(value, limit) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
}

function result(projects, errors, totalRows) {
  return { projects, errors, totalRows, validRows: projects.length, invalidRows: errors.filter((item) => item.row > 1).length };
}

module.exports = { parseDelimitedText, parseMonitoringProjectRows, spreadsheetRows };
