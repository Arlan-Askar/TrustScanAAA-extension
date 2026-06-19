// TrustScan Extension — Popup Script

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE    = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
const RECENT_KEY = "ts_recent_scans";
const MAX_RECENT = 5;

function isBrokerDomain(val) {
  return DOMAIN_RE.test(val) && !EVM_RE.test(val) && !SOL_RE.test(val);
}

// ─── Цвета по скору (крипта) ─────────────────────────────────
function scoreColor(s) {
  if (s === null || s === undefined || s < 0) return "#52525b";
  if (s >= 70) return "#10B981";
  if (s >= 45) return "#F59E0B";
  return "#EF4444";
}
function riskLabel(s) {
  if (s === null || s === undefined) return "UNKNOWN";
  if (s >= 70) return "SAFE";
  if (s >= 45) return "CAUTION";
  return "HIGH RISK";
}

// ─── Цвета/лейблы для брокерских вердиктов ──────────────────
function brokerColor(riskLevel) {
  switch (riskLevel) {
    case "LOW":           return "#10B981";
    case "MEDIUM":        return "#F59E0B";
    case "HIGH":          return "#EF4444";
    case "BLACKLISTED":   return "#EF4444";
    default:              return "#52525b"; // INSUFFICIENT_DATA
  }
}
function brokerLabel(riskLevel) {
  switch (riskLevel) {
    case "LOW":           return "LOW RISK";
    case "MEDIUM":        return "MEDIUM";
    case "HIGH":          return "HIGH RISK";
    case "BLACKLISTED":   return "BLACKLISTED";
    default:              return "NO DATA";
  }
}
function signalColor(val) {
  if (val < 0)  return "#52525b";
  if (val >= 70) return "#10B981";
  if (val >= 45) return "#F59E0B";
  return "#EF4444";
}

// ─── DOM refs ────────────────────────────────────────────────
const addrInput   = document.getElementById("addrInput");
const scanBtn     = document.getElementById("scanBtn");
const statusMsg   = document.getElementById("statusMsg");
const resultCard  = document.getElementById("resultCard");
const resName     = document.getElementById("resName");
const resNetwork  = document.getElementById("resNetwork");
const resBadge    = document.getElementById("resBadge");
const resCircle   = document.getElementById("resCircle");
const resScore    = document.getElementById("resScore");
const resDetails  = document.getElementById("resDetails");
const resFullBtn  = document.getElementById("resFullBtn");
const resCopyBtn  = document.getElementById("resCopyBtn");
const recentList  = document.getElementById("recentList");
const recentSection = document.getElementById("recentSection");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const openAppBtn    = document.getElementById("openApp");

// ─── Показываем/скрываем статус ──────────────────────────────
function showStatus(text, type = "") {
  statusMsg.textContent = "";
  statusMsg.className   = "status-msg visible" + (type ? " " + type : "");
  statusMsg.innerHTML   = text;
  resultCard.classList.remove("visible");
}
function hideStatus() {
  statusMsg.classList.remove("visible");
}

// ─── Рендер результата ───────────────────────────────────────
function renderResult(result, address) {
  hideStatus();

  const s     = result.score;
  const col   = scoreColor(s);
  const label = riskLabel(s);
  const name  = result.symbol || (address.slice(0, 8) + "…" + address.slice(-6));
  const net   = (result.network || "ethereum").toUpperCase();

  resName.textContent    = name;
  resNetwork.textContent = net;

  resBadge.textContent   = label;
  resBadge.style.color        = col;
  resBadge.style.borderColor  = col + "55";
  resBadge.style.background   = col + "18";

  resCircle.style.borderColor = col;
  resScore.textContent        = s !== null ? s : "?";
  resScore.style.color        = col;

  // Details
  const details = [];
  if (result.isHoneypot)                     details.push({ text: "Honeypot detected", bad: true });
  if (result.ownerRenounced)                 details.push({ text: "Owner renounced", bad: false });
  if (result.liquidityUsd > 0) {
    const liqFmt = result.liquidityUsd >= 1000
      ? "$" + (result.liquidityUsd / 1000).toFixed(1) + "k"
      : "$" + result.liquidityUsd;
    details.push({ text: `Liquidity: ${liqFmt}`, bad: false });
  }
  if (!details.length) details.push({ text: "Click for full analysis", bad: false });

  resDetails.innerHTML = details.map(d => `
    <div class="detail-row">
      <span class="dot" style="background:${d.bad ? "#EF4444" : "#10B981"}"></span>
      <span>${d.text}</span>
    </div>
  `).join("");

  // Buttons
  const appUrl = `https://trust-scan-aaa-frontend.vercel.app/?address=${address}&network=${result.network || "ethereum"}`;
  resFullBtn.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_APP", address, network: result.network || "ethereum" });
  resCopyBtn.onclick = () => {
    navigator.clipboard.writeText(appUrl);
    resCopyBtn.textContent = "Copied!";
    setTimeout(() => { resCopyBtn.textContent = "Copy Link"; }, 1500);
  };

  resultCard.classList.add("visible");

  // Сохраняем в recent
  saveRecent({ address, score: s, symbol: result.symbol || "", network: result.network || "ethereum" });
}

// ─── Рендер брокер-результата ────────────────────────────────
function renderBrokerResult(result, domain) {
  hideStatus();

  const rl    = result.riskLevel || "INSUFFICIENT_DATA";
  const col   = brokerColor(rl);
  const label = brokerLabel(rl);
  const score = (result.score >= 0) ? result.score : null;

  resName.textContent    = domain;
  resNetwork.textContent = "🏦 BROKER";

  resBadge.textContent        = label;
  resBadge.style.color        = col;
  resBadge.style.borderColor  = col + "55";
  resBadge.style.background   = col + "18";

  resCircle.style.borderColor = col;
  resScore.textContent        = score !== null ? score : "?";
  resScore.style.color        = col;

  // Три сигнала
  const sig = result.signals || { license: -1, domain: -1, transparency: -1 };
  const sigRows = [
    { name: "License",      val: sig.license },
    { name: "Domain",       val: sig.domain },
    { name: "Transparency", val: sig.transparency },
  ].map(({ name, val }) => {
    const c    = signalColor(val);
    const text = val >= 0 ? `${val}/100` : "No data";
    return `<div class="detail-row">
      <span class="dot" style="background:${c}"></span>
      <span style="color:#a1a1aa">${name}:</span>
      <span style="color:${c};font-weight:700">${text}</span>
    </div>`;
  }).join("");
  resDetails.innerHTML = sigRows;

  const appUrl = `https://trust-scan-aaa-frontend.vercel.app/?address=${encodeURIComponent(domain)}&network=broker`;
  resFullBtn.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_APP", address: domain, network: "broker" });
  resCopyBtn.onclick = () => {
    navigator.clipboard.writeText(appUrl);
    resCopyBtn.textContent = "Copied!";
    setTimeout(() => { resCopyBtn.textContent = "Copy Link"; }, 1500);
  };

  resultCard.classList.add("visible");
  saveRecent({ address: domain, score: score, symbol: "🏦", network: "broker" });
}

// ─── Основной скан ───────────────────────────────────────────
async function doScan(raw) {
  const address = raw.trim();
  const broker  = isBrokerDomain(address);
  const evm     = EVM_RE.test(address.toLowerCase());
  const sol     = SOL_RE.test(address);

  if (!broker && !evm && !sol) {
    showStatus("⚠ Enter a token address (0x…) or broker domain (e.g. binance.com)", "error");
    return;
  }

  scanBtn.disabled   = true;
  addrInput.disabled = true;
  showStatus('<span class="spinner"></span>Scanning…');

  try {
    if (broker) {
      const result = await chrome.runtime.sendMessage({
        type:   "GET_BROKER_SCORE",
        domain: address.toLowerCase(),
      });
      if (result.error === "rate_limit") {
        showStatus("⏳ Daily limit reached.", "rate-limit");
        return;
      }
      if (result.error) {
        showStatus("❌ Could not reach TrustScan. Check connection.", "error");
        return;
      }
      renderBrokerResult(result, address.toLowerCase());
    } else {
      const result = await chrome.runtime.sendMessage({
        type:    "GET_SCORE",
        address: address.toLowerCase(),
        network: "auto",
      });
      if (result.error === "rate_limit") {
        showStatus("⏳ Daily limit reached. <a href='https://t.me/TrustScan_AAA_bot?start=premium' target='_blank' style='color:#F59E0B'>Get Premium →</a>", "rate-limit");
        return;
      }
      if (result.error) {
        showStatus("❌ Could not reach TrustScan. Check connection.", "error");
        return;
      }
      renderResult(result, address.toLowerCase());
    }
  } catch {
    showStatus("❌ Extension error. Try again.", "error");
  } finally {
    scanBtn.disabled   = false;
    addrInput.disabled = false;
  }
}

// ─── Recent scans ─────────────────────────────────────────────
async function loadRecent() {
  const data = await chrome.storage.local.get(RECENT_KEY);
  const list = data[RECENT_KEY] || [];

  if (!list.length) {
    recentSection.style.display = "none";
    return;
  }
  recentSection.style.display = "block";
  recentList.innerHTML = list.map(item => {
    const col = scoreColor(item.score);
    const addr = item.address.slice(0, 8) + "…" + item.address.slice(-6);
    const label = item.symbol ? `${item.symbol} (${addr})` : addr;
    return `
      <div class="recent-item" data-address="${item.address}" data-network="${item.network}">
        <span class="recent-addr" title="${item.address}">${label}</span>
        <span class="recent-score" style="color:${col}">${item.score ?? "?"}</span>
      </div>
    `;
  }).join("");

  recentList.querySelectorAll(".recent-item").forEach(el => {
    el.addEventListener("click", () => {
      addrInput.value = el.dataset.address;
      doScan(el.dataset.address);
    });
  });
}

async function saveRecent(item) {
  const data = await chrome.storage.local.get(RECENT_KEY);
  let list = data[RECENT_KEY] || [];
  // Убираем дубликат
  list = list.filter(r => r.address !== item.address);
  list.unshift(item);
  list = list.slice(0, MAX_RECENT);
  await chrome.storage.local.set({ [RECENT_KEY]: list });
  loadRecent();
}

// ─── Инициализация ───────────────────────────────────────────
scanBtn.addEventListener("click", () => doScan(addrInput.value));
addrInput.addEventListener("keydown", e => { if (e.key === "Enter") doScan(addrInput.value); });
openAppBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_APP" }));
clearCacheBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
  clearCacheBtn.textContent = "Cleared!";
  setTimeout(() => { clearCacheBtn.textContent = "Clear cache"; }, 1500);
});

// Автовставка адреса если на странице выделен EVM-адрес
async function tryPasteFromSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func:   () => window.getSelection()?.toString().trim() || "",
    });
    if (result && (EVM_RE.test(result) || SOL_RE.test(result) || isBrokerDomain(result))) {
      addrInput.value = result;
    }
  } catch { /* нет доступа к вкладке — игнорируем */ }
}

tryPasteFromSelection();
loadRecent();
addrInput.focus();
