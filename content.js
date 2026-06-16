// TrustScan Extension — Content Script
// Находит EVM-адреса на странице и вставляет inline badge со скором.
//
// Алгоритм:
// 1. Сканируем текстовые ноды на странице через TreeWalker
// 2. Находим EVM-адреса (0x + 40 hex символов)
// 3. Оборачиваем в <span> и запрашиваем скор через background
// 4. MutationObserver следит за динамически добавленным контентом (SPA)

(function () {
  "use strict";

  // ─── Константы ───────────────────────────────────────────────
  const EVM_RE       = /\b(0x[0-9a-fA-F]{40})\b/g;
  const PROCESSED    = "data-ts-done";          // маркер обработанного элемента
  const BADGE_CLASS  = "ts-badge";
  const MAX_PER_PAGE = 30;                      // не сканируем больше N адресов на странице

  // Игнорируемые теги — не трогаем код, скрипты, инпуты
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT",
    "CODE", "PRE", "SVG", "CANVAS", "IFRAME",
  ]);

  // ─── Стили badge ──────────────────────────────────────────────
  const STYLE = `
    .${BADGE_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 5px;
      padding: 2px 7px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      vertical-align: middle;
      text-decoration: none !important;
      line-height: 1.4;
      transition: opacity 0.15s;
      white-space: nowrap;
      position: relative;
      z-index: 9999;
      border: 1px solid transparent;
    }
    .${BADGE_CLASS}:hover { opacity: 0.85; }
    .ts-badge-loading {
      background: rgba(80, 80, 100, 0.18);
      border-color: rgba(120,120,150,0.25);
      color: #888;
    }
    .ts-badge-safe {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.35);
      color: #10B981;
    }
    .ts-badge-caution {
      background: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.35);
      color: #F59E0B;
    }
    .ts-badge-danger {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.35);
      color: #EF4444;
    }
    .ts-badge-error {
      background: rgba(100, 100, 120, 0.12);
      border-color: rgba(120,120,150,0.2);
      color: #666;
    }
    .ts-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #131316;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 8px 12px;
      min-width: 160px;
      font-size: 12px;
      color: #f4f4f5;
      line-height: 1.5;
      z-index: 99999;
      pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      white-space: nowrap;
    }
    .${BADGE_CLASS}:hover .ts-tooltip { display: block; }
  `;

  // ─── Внедряем стили один раз ──────────────────────────────────
  function injectStyles() {
    if (document.getElementById("ts-ext-styles")) return;
    const el = document.createElement("style");
    el.id = "ts-ext-styles";
    el.textContent = STYLE;
    (document.head || document.documentElement).appendChild(el);
  }

  // ─── Определяем класс badge по скору ─────────────────────────
  function badgeClass(score) {
    if (score === null || score === undefined) return "ts-badge-error";
    if (score >= 70) return "ts-badge-safe";
    if (score >= 45) return "ts-badge-caution";
    return "ts-badge-danger";
  }

  function badgeEmoji(score) {
    if (score === null || score === undefined) return "?";
    if (score >= 70) return "✓";
    if (score >= 45) return "⚠";
    return "✕";
  }

  // ─── Создаём badge DOM-элемент ────────────────────────────────
  function createBadge(address) {
    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ts-badge-loading`;
    badge.setAttribute("data-address", address);
    badge.textContent = "🛡 …";
    badge.title = "TrustScan: loading...";

    // Клик → открываем полный анализ в новой вкладке
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({
        type:    "OPEN_APP",
        address: address,
        network: "ethereum",
      });
    });

    return badge;
  }

  // ─── Обновляем badge после получения данных ───────────────────
  function updateBadge(badge, result, address) {
    // Удаляем loading класс
    badge.classList.remove("ts-badge-loading");

    if (result.error) {
      if (result.error === "rate_limit") {
        badge.className = `${BADGE_CLASS} ts-badge-error`;
        badge.innerHTML = `🛡 <span>limit</span>`;
        badge.title = "TrustScan: daily limit reached";
      } else {
        // При ошибке сети — тихо убираем badge
        badge.remove();
      }
      return;
    }

    const cls     = badgeClass(result.score);
    const emoji   = badgeEmoji(result.score);
    const scoreStr = result.score !== null ? `${result.score}` : "?";
    const name    = result.symbol || (address.slice(0, 6) + "…" + address.slice(-4));

    badge.className = `${BADGE_CLASS} ${cls}`;

    // Tooltip с деталями
    const tooltip = document.createElement("span");
    tooltip.className = "ts-tooltip";
    tooltip.innerHTML = `
      <strong>🛡 TrustScan</strong><br>
      ${name} · ${result.network || "ETH"}<br>
      Score: <strong>${scoreStr}/100</strong><br>
      ${result.isHoneypot ? "⚠️ Honeypot detected<br>" : ""}
      ${result.ownerRenounced ? "✓ Owner renounced<br>" : ""}
      <span style="color:#666;font-size:10px">Click to view full analysis</span>
    `;

    badge.innerHTML = `🛡 <span>${emoji} ${scoreStr}</span>`;
    badge.appendChild(tooltip);
    badge.title = `TrustScan: ${scoreStr}/100 — click for full analysis`;
  }

  // ─── Трекер обработанных адресов на текущей странице ─────────
  const processedAddresses = new Map(); // address → badge element
  let scanCount = 0;

  // ─── Запрашиваем скор и обновляем badge ──────────────────────
  async function fetchAndUpdate(address, badge) {
    try {
      const result = await chrome.runtime.sendMessage({
        type:    "GET_SCORE",
        address: address,
        network: "auto",
      });
      updateBadge(badge, result, address);
    } catch {
      badge.remove();
    }
  }

  // ─── Обрабатываем один текстовый нод ─────────────────────────
  function processTextNode(node) {
    const text = node.textContent;
    if (!EVM_RE.test(text)) return;
    EVM_RE.lastIndex = 0;

    // Не трогаем уже обработанные
    if (node.parentElement?.hasAttribute(PROCESSED)) return;
    if (node.parentElement?.classList.contains(BADGE_CLASS)) return;

    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return;

    // Разбиваем текст на части: текст + адрес
    const parts  = [];
    let lastIdx  = 0;
    let match;

    EVM_RE.lastIndex = 0;
    while ((match = EVM_RE.exec(text)) !== null) {
      if (scanCount >= MAX_PER_PAGE) break;

      const addr = match[1].toLowerCase();

      // Уже добавляли badge для этого адреса
      if (processedAddresses.has(addr)) continue;

      // Текст до адреса
      if (match.index > lastIdx) {
        parts.push(document.createTextNode(text.slice(lastIdx, match.index)));
      }

      // Сам адрес как текст (не меняем)
      parts.push(document.createTextNode(match[1]));

      // Badge после адреса
      const badge = createBadge(addr);
      parts.push(badge);

      processedAddresses.set(addr, badge);
      scanCount++;

      // Запрос с небольшой задержкой чтобы не флудить
      setTimeout(() => fetchAndUpdate(addr, badge), scanCount * 120);

      lastIdx = match.index + match[0].length;
    }
    EVM_RE.lastIndex = 0;

    if (parts.length === 0) return;

    // Остаток текста
    if (lastIdx < text.length) {
      parts.push(document.createTextNode(text.slice(lastIdx)));
    }

    // Заменяем текстовый нод на fragment с badge
    const frag = document.createDocumentFragment();
    parts.forEach(p => frag.appendChild(p));
    parent.setAttribute(PROCESSED, "1");
    parent.replaceChild(frag, node);
  }

  // ─── Сканируем DOM через TreeWalker ──────────────────────────
  function scanDOM(root) {
    if (scanCount >= MAX_PER_PAGE) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.hasAttribute(PROCESSED))    return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.classList.contains(BADGE_CLASS)) return NodeFilter.FILTER_REJECT;
          if (!node.textContent.includes("0x"))               return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
      if (nodes.length + scanCount >= MAX_PER_PAGE) break;
    }
    // Обрабатываем отдельно — нельзя менять DOM во время walk
    nodes.forEach(processTextNode);
  }

  // ─── MutationObserver для SPA (Uniswap, DexScreener и т.д.) ─
  let mutationTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (scanCount >= MAX_PER_PAGE) return;

    // Debounce: ждём 400ms после последней мутации
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanDOM(node);
          }
        }
      }
    }, 400);
  });

  // ─── Инициализация ───────────────────────────────────────────
  function init() {
    injectStyles();
    scanDOM(document.body);
    observer.observe(document.body, {
      childList: true,
      subtree:   true,
    });
  }

  // Ждём готовности DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
