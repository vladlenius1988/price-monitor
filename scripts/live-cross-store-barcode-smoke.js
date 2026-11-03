const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const executableArgument = process.argv.find((value) => value.startsWith('--executable='));
const packagedExecutable = String(
  executableArgument?.slice('--executable='.length) || process.env.PRICE_MONITOR_SMOKE_EXECUTABLE || ''
).trim();
const electron = packagedExecutable || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const port = 9338;
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-barcode-smoke-'));
const barcode = String(process.argv.slice(2).find((value) => !value.startsWith('--')) || '3600531609764').trim();
let stdout = '';
let stderr = '';

const child = spawn(electron, [
  `--remote-debugging-port=${port}`,
  ...(packagedExecutable ? [] : [root]),
  '--test-hidden',
  `--test-user-data=${testData}`,
], {
  cwd: root,
  env: { ...process.env, PRICE_MONITOR_EDITION: 'demo' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && /index\.html/i.test(target.url));
      if (page?.webSocketDebuggerUrl) return page;
    } catch (_error) {
      // Electron ще запускається.
    }
    await wait(300);
  }
  throw new Error('barcode_smoke_page_timeout');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluation_failed');
  return result.result?.value;
}

async function waitForInterface(client) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, `Boolean(
      window.priceParser
      && window.priceMonitorCrossStoreBarcode
      && document.querySelector('#show-barcode-monitor')
      && document.querySelector('#barcode-monitor-start')
    )`).catch(() => false);
    if (ready) return;
    await wait(300);
  }
  throw new Error('barcode_smoke_interface_timeout');
}

async function runSearch(client, timeoutMs = 420000) {
  await evaluate(client, `(() => {
    document.querySelector('#show-barcode-monitor').click();
    const input = document.querySelector('#barcode-monitor-query');
    input.value = ${JSON.stringify(barcode)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#barcode-monitor-start').click();
    return true;
  })()`);

  const deadline = Date.now() + timeoutMs;
  let seenBusy = false;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await evaluate(client, `(() => {
      const cancel = document.querySelector('#barcode-monitor-cancel');
      const status = document.querySelector('#barcode-monitor-status');
      return {
        busy: cancel ? !cancel.hidden : false,
        status: status?.textContent || '',
        statusType: status?.dataset?.type || '',
        rows: document.querySelectorAll('#barcode-monitor-rows tr').length,
        exactRows: document.querySelectorAll('#barcode-monitor-rows .is-exact').length,
        stores: [...document.querySelectorAll('#barcode-monitor-stores .barcode-monitor-store')]
          .map((item) => item.textContent.trim()),
        exportEnabled: !document.querySelector('#barcode-monitor-export')?.disabled,
      };
    })()`);
    if (snapshot.busy) seenBusy = true;
    if (seenBusy && !snapshot.busy && snapshot.statusType !== 'loading') return snapshot;
    await wait(1000);
  }
  throw new Error(`barcode_smoke_search_timeout:${JSON.stringify(snapshot)}`);
}

async function main() {
  let client;
  try {
    const page = await findPage();
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    await waitForInterface(client);
    const result = await runSearch(client);
    if (!result.exactRows) throw new Error(`barcode_smoke_no_exact_match:${result.status}`);
    if (!result.exportEnabled) throw new Error(`barcode_smoke_export_disabled:${result.status}`);
    process.stdout.write(`${JSON.stringify({ ok: true, barcode, result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, stdout, stderr }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    try { await client?.send('Browser.close'); } catch (_error) { child.kill(); }
    await wait(500);
    if (!child.killed) child.kill();
    fs.rmSync(testData, { recursive: true, force: true });
  }
}

main();
