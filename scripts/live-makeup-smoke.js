const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packagedExecutable = String(process.env.PRICE_MONITOR_SMOKE_EXECUTABLE || '').trim();
const electron = packagedExecutable || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const port = 9337;
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-makeup-smoke-'));
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['lipss', 'pop gossip'];
let stdout = '';
let stderr = '';

const launchArguments = [
  `--remote-debugging-port=${port}`,
  ...(packagedExecutable ? [] : [root]),
  '--test-hidden',
  `--test-user-data=${testData}`,
];
const child = spawn(electron, launchArguments, {
  cwd: root,
  env: { ...process.env, PRICE_MONITOR_EDITION: 'demo' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  throw new Error('makeup_smoke_page_timeout');
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
    socket,
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
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluation_failed');
  return result.result?.value;
}

async function waitForInterface(client) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, `Boolean(
      window.priceParser
      && document.querySelector('[data-store="makeup"]')
      && document.querySelector('#parse-products')
    )`).catch(() => false);
    if (ready) return;
    await wait(300);
  }
  throw new Error('makeup_smoke_interface_timeout');
}

async function runQuery(client, query, timeoutMs = 180000) {
  await evaluate(client, `(() => {
    document.querySelector('[data-store="makeup"]').click();
    const input = document.querySelector('#brand-query');
    input.value = ${JSON.stringify(query)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#parse-products').click();
    return true;
  })()`);
  const deadline = Date.now() + timeoutMs;
  let seenBusy = false;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await evaluate(client, `(() => {
      const cancel = document.querySelector('#cancel-products');
      const status = document.querySelector('#status');
      return {
        busy: cancel ? !cancel.hidden : false,
        status: status?.textContent || '',
        statusType: status?.dataset?.type || '',
        rows: document.querySelectorAll('#product-table tbody tr').length,
        meta: document.querySelector('#result-meta')?.textContent || ''
      };
    })()`);
    if (snapshot.busy) seenBusy = true;
    if (seenBusy && !snapshot.busy && snapshot.statusType !== 'loading') return snapshot;
    await wait(750);
  }
  throw new Error(`makeup_smoke_search_timeout:${query}:${JSON.stringify(snapshot)}`);
}

async function main() {
  let client;
  try {
    const page = await findPage();
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    await waitForInterface(client);
    const results = [];
    for (const query of queries) {
      const result = await runQuery(client, query);
      results.push({ query, ...result });
      if (!result.rows) throw new Error(`makeup_smoke_no_rows:${query}:${result.status}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
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
