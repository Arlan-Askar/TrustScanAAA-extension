// TrustScan Extension — Background Service Worker
// Отвечает за:
// 1. Проксирование запросов к TrustScan API (обход CORS)
// 2. Кэш результатов в chrome.storage.local (TTL 10 минут)
// 3. Обновление иконки badge при активной вкладке

const API_BASE = "http://localhost:8080";
const CACHE_TTL  = 10 * 60 * 1000; // 10 минут в мс

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

    // Сохраняем в кэш
    await chrome.storage.local.set({
      [cacheKey]: { data: result, ts: Date.now() },
    });

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
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith("ts_score_"));
  if (keys.length <= 200) return;

  // Удаляем самые старые
  const sorted = keys
    .map(k => ({ key: k, ts: all[k]?.ts ?? 0 }))
    .sort((a, b) => a.ts - b.ts);

  const toDelete = sorted.slice(0, sorted.length - 150).map(e => e.key);
  await chrome.storage.local.remove(toDelete);
}

// ─── Message handler от content script / popup ───────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_SCORE") {
    getTokenScore(msg.address, msg.network || "auto")
      .then(sendResponse)
      .catch(err => sendResponse({ error: String(err) }));
    return true; // async response
  }

  if (msg.type === "CLEAR_CACHE") {
    chrome.storage.local.get(null).then(all => {
      const keys = Object.keys(all).filter(k => k.startsWith("ts_score_"));
      chrome.storage.local.remove(keys).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === "OPEN_APP") {
    const url = msg.address
      ? `https://trust-scan-aaa-frontend.vercel.app/?address=${msg.address}&network=${msg.network || "ethereum"}`
      : "https://trust-scan-aaa-frontend.vercel.app/";
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }
});
