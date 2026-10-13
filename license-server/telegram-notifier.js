class TelegramNotifier {
  constructor({ store, fetchFn = globalThis.fetch } = {}) {
    this.store = store;
    this.fetchFn = fetchFn;
  }

  async send(message) {
    const settings = await this.store.getSettings();
    if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
      return { sent: false, reason: 'telegram_not_configured' };
    }
    const response = await this.fetchFn(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text: String(message || '').slice(0, 4000) }),
    });
    if (!response?.ok) throw new Error('telegram_send_failed');
    return { sent: true, reason: '' };
  }

  async notifyOnce(key, message) {
    if (await this.store.hasEventDetail('telegram_notice', key)) return { sent: false, reason: 'already_sent' };
    const result = await this.send(message);
    if (result.sent) {
      await this.store.appendEvent({
        type: 'telegram_notice', licenseId: '', deviceId: '', occurredAt: new Date().toISOString(), ip: '', details: { key },
      });
    }
    return result;
  }

  async sweep() {
    const licenses = await this.store.listLicenses();
    const today = startOfDay(Date.now());
    for (const license of licenses) {
      const end = startOfDay(Date.parse(license.paidUntil));
      const days = Math.round((end - today) / 86400000);
      if (![7, 1, 0].includes(days)) continue;
      const label = days === 7 ? 'через 7 днів' : days === 1 ? 'завтра' : 'сьогодні';
      await this.notifyOnce(
        `payment:${license.id}:${license.paidUntil}:${days}`,
        `Price Monitor: оплата клієнта «${license.customerName}» завершується ${label} (${String(license.paidUntil).slice(0, 10)}).`,
      ).catch(() => {});
    }
  }
}

function startOfDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

module.exports = { TelegramNotifier };
