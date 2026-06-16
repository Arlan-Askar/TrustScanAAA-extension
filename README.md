# TrustScan Chrome Extension

Instant token safety badge on any webpage that shows EVM addresses.

## Structure

```
trustscan-extension/
├── manifest.json      # Chrome MV3 manifest
├── background.js      # Service worker: API calls + cache (10 min TTL)
├── content.js         # Finds EVM addresses, injects badges
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic
└── icons/
    ├── icon.svg
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Local Installation (dev)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `trustscan-extension/` folder
5. Extension is active — visit any page with token addresses

## How it works

**Content Script** scans page text nodes via `TreeWalker`, finds EVM addresses
(`0x` + 40 hex chars), wraps them with a badge element.

**Background Worker** calls `POST https://trustscan.app/analyze` for each address,
caches results in `chrome.storage.local` for 10 minutes.
Max 30 addresses per page to avoid flooding.

**Badge colors:**
- 🟢 Green  → score ≥ 70 (SAFE)
- 🟡 Yellow → score 45–69 (CAUTION)
- 🔴 Red    → score < 45  (HIGH RISK)

**Popup** — quick scan by manual address input. Auto-pastes selected text if it's an EVM address.

## Publishing to Chrome Web Store

1. Zip the folder: `zip -r trustscan-extension.zip trustscan-extension/`
2. Go to https://chrome.google.com/webstore/devconsole
3. Pay one-time $5 developer fee
4. Upload ZIP → fill in description + screenshots
5. Submit for review (~3–7 days)

## Backend change needed

Add `source: "extension"` tracking to `/analyze` endpoint to measure
extension-driven traffic separately in analytics:

```go
// In scanHandler, read optional "source" field
source := body["source"] // "extension" | "webapp" | "api"
// Log or store for analytics
```

## .env addition (optional, for rate limiting by source)

```
EXTENSION_RATE_LIMIT=50   # requests per day per IP from extension
```
