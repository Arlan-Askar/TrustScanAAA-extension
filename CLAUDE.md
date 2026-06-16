# TrustScan Extension — Сводка проекта

**Статус:** MVP, подключён к прод-бэкенду; готов к публикации в Chrome Web Store  
**Стек:** Chrome Extension Manifest V3 (ванильный JS, без фреймворков)  
**Последнее обновление:** июнь 2026 (переключён на прод-бэкенд)

---

## Что такое TrustScan Extension?

Chrome-расширение, которое автоматически находит EVM-адреса на любой странице
и показывает inline-бейдж с Trust Score прямо рядом с адресом. Плюс popup для
ручного ввода адреса.

---

## Архитектура

### Файлы

| Файл | Роль |
|---|---|
| `manifest.json` | Chrome MV3 манифест: `service_worker`, `content_scripts`, `permissions` |
| `background.js` | Service worker: API-прокси, кэш результатов (TTL 10 мин) |
| `content.js` | Content script: сканирует текстовые ноды, вставляет бейджи |
| `popup.html` / `popup.js` | Popup UI: ручной ввод адреса, история последних 5 сканов |
| `icons/` | Иконки 16/32/48/128 px + SVG-исходник |

### `content.js` — логика бейджей
- `TreeWalker` обходит текстовые ноды DOM; пропускает `script`, `style`, `input`, `code` и др.
- Regex `\b(0x[0-9a-fA-F]{40})\b` — ищет EVM-адреса
- Лимит `MAX_PER_PAGE = 30` — защита от флуда на страницах с большим количеством адресов
- `MutationObserver` — подхватывает динамически добавленный контент (SPA-сайты)
- Маркер `data-ts-done` на уже обработанных элементах — исключает повторную обработку
- Бейдж вставляется как `<span class="ts-badge">` с цветом по скору

### `background.js` — сервис-воркер
- Перехватывает `chrome.runtime.onMessage` от content script и popup
- `POST {API_BASE}/analyze` — основной API-запрос
- Кэш в `chrome.storage.local`: ключ `ts_score_{address}_{network}`, TTL 10 минут
- `API_BASE = "https://trustscanaaa-backend.onrender.com"` (прод); для локалки раскомментировать `http://localhost:8080`
- Обновляет badge-иконку расширения при активной вкладке

### `popup.js` — popup
- Ручной ввод EVM-адреса; валидация `/^0x[0-9a-fA-F]{40}$/`
- История последних 5 сканов в `chrome.storage.local` (ключ `ts_recent_scans`)
- Цвета и метки по скору:
  - ≥ 70 → зелёный `#10B981` → `SAFE`
  - 45–69 → жёлтый `#F59E0B` → `CAUTION`
  - < 45 → красный `#EF4444` → `HIGH RISK`

---

## Разрешения (manifest.json)

- `"storage"` — `chrome.storage.local` для кэша и истории
- `host_permissions: ["https://trustscan.app/*", "https://trustscanaaa-backend.onrender.com/*"]` — доступ к API

---

## Развёртывание / установка

### Локальная установка (dev)
1. Chrome → `chrome://extensions/` → включить **Developer mode**
2. **Load unpacked** → выбрать папку `trustscan-extension/`
3. Расширение активно — открыть страницу с EVM-адресами

### Публикация в Chrome Web Store
1. Создать ZIP: `zip -r trustscan-extension.zip trustscan-extension/`
2. Chrome Web Store Developer Console → загрузить ZIP
3. Разовый сбор $5 за аккаунт разработчика
4. Ревью ~3–7 дней

---

## Что дальше?

- Добавить поддержку Solana-адресов в content.js
- Поддержка брокер-сканирования из popup (ввод домена)
- Передавать `source: "extension"` в `/analyze` для аналитики трафика
- Публикация в Chrome Web Store
- Обновляй этот файл каждый раз, когда происходит важное обновление в коде
