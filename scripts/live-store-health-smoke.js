const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-store-health-'));
const resultFile = path.join(testData, 'result.json');
const child = spawn(electron, [path.join(__dirname, 'store-health-smoke-app'), '--test-hidden'], {
  cwd: root,
  env: { ...process.env, PRICE_MONITOR_HEALTH_TEST_DATA: testData, PRICE_MONITOR_HEALTH_RESULT: resultFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  waitForResult(code).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, exitCode: code })}\n`);
    process.exitCode = 1;
  });
});

async function waitForResult(exitCode) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!fs.existsSync(resultFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!fs.existsSync(resultFile)) throw new Error('health_smoke_result_timeout');
  const text = fs.readFileSync(resultFile, 'utf8');
  process.stdout.write(`${text}\n`);
  const payload = JSON.parse(text);
  await new Promise((resolve) => setTimeout(resolve, 750));
  fs.rmSync(testData, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  process.exitCode = exitCode || (payload.ok ? 0 : 1);
}
