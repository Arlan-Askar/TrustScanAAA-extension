// TrustScan Extension — Background Service Worker
// Отвечает за:
// 1. Проксирование запросов к TrustScan API (обход CORS)
// 2. Кэш результатов в chrome.storage.local (TTL 10 минут)
// 3. Обновление иконки badge при активной вкладке

const API_BASE = "https://trustscanaaa-backend.onrender.com"; // prod
// const API_BASE = "http://localhost:8080";                  // dev — раскомментировать для локалки
const CACHE_TTL       = 10 * 60 * 1000; // 10 минут в мс
const CACHE_INDEX_KEY = "ts_cache_index"; // индекс всех ts_score_* ключей → timestamp

// ─── Получить скор токена (с кэшем) ──────────────────────────
async function getTokenScore(address, network = "auto") {
  const cacheKey = `ts_score_${address.toLowerCase()}_${network}`;

  // Проверяем кэш
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    const entry = cached[cacheKey];
    if (Date.now() - entry.ts < CACHE_TTL) {
      return entry.data;
    }
  }

  // Запрос к API
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ address, network, lang: "en", source: "extension" }),
      signal:  AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 429) return { error: "rate_limit" };
      return { error: "api_error", status: res.status };
    }

    const data = await res.json();

    const result = {
      score:     data.score          ?? null,
      riskLevel: data.risk_level     ?? "unknown",
      symbol:    data.token          ?? "",
      network:   data.network        ?? network,
      isHoneypot: data.is_honeypot   ?? false,
      ownerRenounced: data.owner_renounced ?? false,
      liquidityUsd:   data.liquidity_usd   ?? 0,
      address:   address.toLowerCase(),
    };

    const now = Date.now();

    // Сохраняем в кэш
    await chrome.storage.local.set({
      [cacheKey]: { data: result, ts: now },
    });

    // Обновляем индекс
    const idxStore = await chrome.storage.local.get(CACHE_INDEX_KEY);
    const idx = idxStore[CACHE_INDEX_KEY] ?? {};
    idx[cacheKey] = now;
    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: idx });

    // Чистим старые записи если их больше 200
    cleanOldCache();

    return result;
  } catch (err) {
    if (err.name === "TimeoutError") return { error: "timeout" };
    return { error: "network_error" };
  }
}

// ─── Чистка старого кэша ─────────────────────────────────────
async function cleanOldCache() {
  const idxStore = await chrome.storage.local.get(CACHE_INDEX_KEY);
  const idx = idxStore[CACHE_INDEX_KEY] ?? {};
  const keys = Object.keys(idx);
  if (keys.length <= 200) return;

  // Удаляем самые старые
  const sorted = keys
    .map(k => ({ key: k, ts: idx[k] ?? 0 }))
    .sort((a, b) => a.ts - b.ts);

  const toDelete = sorted.slice(0, sorted.length - 150).map(e => e.key);
  await chrome.storage.local.remove(toDelete);
  toDelete.forEach(k => delete idx[k]);
  await chrome.storage.local.set({ [CACHE_INDEX_KEY]: idx });
}

// ─── Получить скор брокера/домена (с кэшем) ─────────────────
async function getBrokerScore(domain) {
  const cacheKey = `ts_score_broker_${domain.toLowerCase()}`;

  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    const entry = cached[cacheKey];
    if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
  }

  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ address: domain, network: "broker", lang: "en", source: "extension" }),
      signal:  AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 429) return { error: "rate_limit" };
      return { error: "api_error", status: res.status };
    }

    const data = await res.json();
    const result = {
      type:      "broker",
      score:     data.score      ?? -1,
      riskLevel: data.risk_level ?? "INSUFFICIENT_DATA",
      domain:    domain.toLowerCase(),
      signals:   data.broker_signals ?? { license: -1, domain: -1, transparency: -1 },
      risks:     data.risks ?? [],
    };

    const now = Date.now();
    await chrome.storage.local.set({ [cacheKey]: { data: result, ts: now } });

    const idxStore = await chrome.storage.local.get(CACHE_INDEX_KEY);
    const idx = idxStore[CACHE_INDEX_KEY] ?? {};
    idx[cacheKey] = now;
    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: idx });
    cleanOldCache();

    return result;
  } catch (err) {
    if (err.name === "TimeoutError") return { error: "timeout" };
    return { error: "network_error" };
  }
}

// ─── Message handler от content script / popup ───────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_SCORE") {
    getTokenScore(msg.address, msg.network || "auto")
      .then(sendResponse)
      .catch(err => sendResponse({ error: String(err) }));
    return true;
  }

  if (msg.type === "GET_BROKER_SCORE") {
    getBrokerScore(msg.domain)
      .then(sendResponse)
      .catch(err => sendResponse({ error: String(err) }));
    return true;
  }

  if (msg.type === "CLEAR_CACHE") {
    chrome.storage.local.get(CACHE_INDEX_KEY).then(idxStore => {
      const idx = idxStore[CACHE_INDEX_KEY] ?? {};
      const keys = Object.keys(idx);
      Promise.all([
        chrome.storage.local.remove(keys),
        chrome.storage.local.remove(CACHE_INDEX_KEY),
      ]).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === "OPEN_APP") {
    let url = "https://trust-scan-aaa-frontend.vercel.app/";
    if (msg.address) {
      const net = msg.network || "ethereum";
      url = `https://trust-scan-aaa-frontend.vercel.app/?address=${encodeURIComponent(msg.address)}&network=${net}`;
    }
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }
});
