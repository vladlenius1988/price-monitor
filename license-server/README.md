# Локальна підготовка сервера Price Monitor

Цей каталог містить локальний контур сервера ліцензій, оновлень і сповіщень. Панель власника та публічний клієнтський API навмисно розділені.

## Запуск

```powershell
npm run license-server:local
```

Після запуску:

- панель власника: `http://127.0.0.1:8787/admin`;
- перевірка клієнтського API: `http://127.0.0.1:8788/health`;
- стандартний локальний токен: `local-admin`.

Для іншого токена перед запуском задайте `PRICE_MONITOR_ADMIN_TOKEN`. Панель завжди слухає лише `127.0.0.1`; на публічному порту немає адміністративних маршрутів.

Локальна база зберігається у `license-server/data/local-db.json` і не повинна потрапляти до репозиторію або клієнтської збірки.

## Правила за замовчуванням

- перевірка застосунком: під час запуску та не рідше одного разу на добу;
- автономний допуск: 14 днів, змінюється окремо для кожної ліцензії;
- кількість пристроїв, дата оплати, магазини, функції та канал оновлень змінюються без перевипуску програми;
- новий пристрій займає місце лише після правильної активації;
- видалений пристрій звільняє місце;
- приватний ключ ніколи не входить до клієнтської збірки.
- нова ліцензія з панелі одразу активна, але працює лише після введення виданого коду активації;
- маніфести оновлень підписуються тим самим Ed25519-ключем, а клієнт додатково перевіряє SHA-256 файла;
- Telegram вимкнений, доки власник сам не збереже Bot token і Chat ID.

## Тестовий сервер Cloudflare

Тестовий контур уже розгорнуто окремо від локального сервера:

- Worker: `price-monitor-license-staging`;
- HTTPS API: `https://price-monitor-license-staging.vladlenius.workers.dev`;
- база: Cloudflare D1 `price-monitor-staging`;
- середовище: `staging`;
- секрети `LICENSE_PRIVATE_KEY_B64` та `ADMIN_TOKEN` зберігаються тільки у Cloudflare і ніколи не додаються до Git.

Перевірка доступності:

```powershell
Invoke-RestMethod https://price-monitor-license-staging.vladlenius.workers.dev/health
```

Застосування нових міграцій із каталогу `license-server`:

```powershell
npx wrangler d1 migrations apply price-monitor-staging --remote --env staging --config wrangler.jsonc
```

Публікація перевіреної серверної версії з каталогу `license-server`:

```powershell
npx wrangler deploy --env staging --config wrangler.jsonc
```

Перед публікацією обов'язково виконати `npm test` у корені проєкту. Staging лишається полігоном і не містить бойових ліцензій.

## Production-контур 4.24.0

Бойовий контур повністю відокремлений від staging:

- Worker: `price-monitor-license-production`;
- HTTPS API: `https://price-monitor-license-production.vladlenius.workers.dev`;
- база: Cloudflare D1 `price-monitor-production`;
- середовище: `production`;
- окремий Ed25519-ключ підпису ліцензій;
- окремий токен власника у `%APPDATA%\Price Monitor Owner\admin-token.txt`;
- обмеження частоти активацій, перевірок та адміністративних запитів;
- щоденне прибирання лише тимчасових лічильників захисту;
- журнал клієнтських і адміністративних дій;
- публічний `/health` перевіряє не лише Worker, а й реальну готовність D1.

Перевірка:

```powershell
Invoke-RestMethod https://price-monitor-license-production.vladlenius.workers.dev/health
```

Production-клієнт використовує файл `license-public-production.pem`. Закритий ключ знаходиться лише у секретах Cloudflare та локальному каталозі `.license-private`, який виключено з Git.

## Безпечна публікація

Звичайна production-публікація спочатку створює локальний SQL-бекап, потім застосовує міграції, публікує Worker і перевіряє `/health`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File license-server/scripts/deploy-cloud.ps1 -Environment production
```

`-SkipBackup` дозволено лише для найпершого розгортання порожньої бази. Для staging резервна копія перед публікацією не є обов'язковою.

Окремий ручний бекап:

```powershell
npm run cloud:backup:production
```

Файли зберігаються у `backups/cloud/production/` разом із SHA-256 і не додаються до Git.

## Відновлення D1

Cloudflare Time Travel зберігає можливість повернути production-базу до попереднього стану. Спочатку лише отримати закладку, нічого не змінюючи:

```powershell
npx wrangler d1 time-travel info price-monitor-production --env production --config license-server/wrangler.jsonc --json
```

Відновлення є руйнівною операцією. Перед ним обов'язково зробити свіжий SQL-бекап і перевірити точну закладку. Команду `time-travel restore` не запускати як частину автоматичного деплою.
