const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalLicenseStore } = require('./local-store');
const { TelegramNotifier } = require('./telegram-notifier');

test('Telegram notifications stay disabled until configured and deduplicate owner alerts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-telegram-'));
  try {
    const store = new LocalLicenseStore(path.join(directory, 'db.json'));
    const sent = [];
    const notifier = new TelegramNotifier({
      store,
      fetchFn: async (url, options) => {
        sent.push({ url, body: JSON.parse(options.body) });
        return { ok: true };
      },
    });
    assert.equal((await notifier.send('До налаштування')).sent, false);
    await store.updateSettings({ telegramEnabled: true, telegramBotToken: '123:test-token', telegramChatId: '456789' });
    assert.equal((await notifier.notifyOnce('new-device:a', 'Новий пристрій')).sent, true);
    assert.equal((await notifier.notifyOnce('new-device:a', 'Новий пристрій')).reason, 'already_sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.chat_id, '456789');
    assert.equal(sent[0].body.text, 'Новий пристрій');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
