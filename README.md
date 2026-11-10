# Fiyat Takip — Chrome Extension v2.0

A Chrome extension that tracks price history on Trendyol, Hepsiburada and Amazon TR product pages, shows it as a chart, and helps you make smarter shopping decisions.

---

## Project Structure

```
chormePriceExtens/
│
├── manifest.json            ← Extension definition file (Manifest V3)
├── background.js            ← Service Worker — background processing
├── content.js               ← Main script injected into the product page
├── styles.css               ← Widget stylesheet (light/dark theme)
├── popup.html               ← Panel that opens when the extension icon is clicked
├── popup.js                 ← Popup panel logic
├── seed-demo-data.js        ← Script that creates demo data for testing
├── generate-icons.html      ← Helper page for generating icons
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── lib/
│   └── chart.min.js         ← Chart.js v4.4.7 (charting library)
│
└── server/                  ← Optional backend API
    ├── package.json
    └── server.js
```

---

## System Architecture

### Overall Flow

```
User opens a product page
        │
        ▼
   content.js runs
        │
        ├── Site detection (Trendyol / Hepsiburada / Amazon TR)
        ├── Product ID, name, price and image are extracted
        ├── Widget is injected into the page
        │
        ▼
   Message is sent to background.js
        │
        ├── Price is saved (API or chrome.storage.local)
        ├── History data is fetched
        ├── Subscription status is checked
        │
        ▼
   Widget is updated
        │
        ├── Statistics are calculated
        ├── Chart is drawn (Chart.js)
        ├── Prediction is made
        ├── Installments are calculated
        └── Other sellers are listed
```

### Per-File Details

#### `manifest.json` — Extension Definition
- In **Manifest V3** format
- Supported sites: `trendyol.com`, `hepsiburada.com`, `amazon.com.tr`
- Permissions: `storage`, `activeTab`, `tabs`, `alarms`, `notifications`
- `chart.min.js` and `content.js` are loaded as content scripts
- `background.js` runs as the Service Worker

#### `content.js` — Main Content Script (In-Page)

This file is injected into the product page automatically and builds the entire user interface.

**Multi-Site Adapter System:**
```
SITE is detected (by hostname)
        │
        ▼
There is a separate adapter object for each site:
  - trendyol:    -p-{ID} URL pattern, .prc-dsc price selector  → ID: ty-{ID}
  - hepsiburada: -p-{ID} or data-product-id attribute          → ID: hb-{ID}
  - amazon:      /dp/{ASIN} URL pattern                        → ID: az-{ASIN}
```

Product IDs are stored with a site prefix (`ty-`, `hb-`, `az-`), so identical numbers on different sites don't collide.

Each adapter provides these methods:
- `getProductId()` → Extracts the product ID
- `getProductName()` → Extracts the product name
- `getProductPrice()` → Extracts the price (Turkish format: 43.999,00 TL)
- `getProductImage()` → Product image URL
- `getOtherSellers()` → Other sellers' prices (the Amazon adapter returns an empty list)

**Price Parsing System (parseTRPrice):**
```
Input: "43.999,50 TL"
  → Strip letters/symbols: "43.999,50"
  → Remove dots (thousands separator): "43999,50"
  → Convert comma to dot: "43999.50"
  → parseFloat: 43999.5
```

If the known selectors in the Trendyol adapter can't find the price, it falls back to scanning all `<span>` elements on the page and takes the value matching the TL price pattern inside an element that carries a price class. The Hepsiburada and Amazon adapters don't have this fallback.

**Widget Construction:**
- All DOM elements are created with JavaScript (innerHTML isn't used — for XSS safety)
- Elements are created with the `mk()` helper function
- SVG icons are parsed through DOMParser with `svgIcon()`

**Dragging (Drag & Drop):**
- The widget can be dragged by its header
- The position is saved with `chrome.storage.local`
- It opens in the same position when the page is reloaded

**SPA Navigation:**
- DOM changes are watched with `MutationObserver`
- When the URL changes, the widget is removed and rebuilt for the new product
- Catches navigation without a page reload on SPA sites like Trendyol

**Price Prediction (Linear Regression):**
```
Simple linear regression is applied to the last 7 data points:
  slope = (n·ΣXY - ΣX·ΣY) / (n·ΣX² - (ΣX)²)

slope < -1  → "Düşüş trendi — beklemeniz faydalı olabilir"
slope > 1   → "Yükseliş trendi — erken almayı düşünün"
otherwise   → "Fiyat stabil görünüyor"
```

(The messages read: "Downward trend — waiting may pay off", "Upward trend — consider buying early", "Price looks stable".)

The prediction is shown when there are at least 3 data points; next to it, a next-price estimate calculated as "current price + slope" is displayed.

#### `background.js` — Service Worker (Background)

All data operations and API communication happen here.

**Messaging System:**
The content script and popup communicate with background.js via `chrome.runtime.sendMessage`.

| Message Type | Direction | Description |
|---|---|---|
| `TRACK_PRICE` | content → bg | Save price |
| `GET_HISTORY` | content/popup → bg | Get price history |
| `GET_SERVER_PRODUCTS` | popup → bg | Product list on the server (empty if the server is down) |
| `GET_SUBSCRIPTION` | content/popup → bg | Subscription status |
| `UPGRADE_PRO` | content/popup → bg | Upgrade to Pro |
| `DOWNGRADE_FREE` | popup → bg | Downgrade to Free |
| `SET_ALERT` | content → bg | Set a target price alert |
| `REMOVE_ALERT` | content → bg | Remove the alert |
| `GET_ALERT` | content → bg | Get alert info |
| `EXPORT_CSV` | content → bg | CSV export |

**Data Storage (Dual System):**
```
Price save request arrives
        │
        ▼
  Try POST /api/track on the backend API
        │
    Success? ──Yes──→ Done
        │
       No (server down)
        │
        ▼
  Save to chrome.storage.local (fallback)
```

Storage key format: `price_{productId}` (e.g. `price_ty-123456`)
Array per product: `[{ date: "2026-03-24", price: 43999, name: "Samsung..." }, ...]`

If another save arrives on the same day, that day's entry is updated (one data point per day).

> **Caution:** If saving to the API succeeds, the data is written only to the server, not to `chrome.storage.local`. That's why the popup and the periodic alarm check read history from the server first (`GET_HISTORY` / `GET_SERVER_PRODUCTS`) and fall back to local data if the server is down. Local and server records are not synchronized with each other.

**Alert System:**
- The user sets a target price from the widget
- Every time the product page is opened (`TRACK_PRICE`), the current price is compared with the target
- In addition, a check runs every 4 hours via `chrome.alarms`; this check doesn't re-fetch pages, it looks at the last saved price (from the server if it's up, otherwise from local storage)
- If the price is equal to or below the target, a notification is sent via `chrome.notifications`
- After the notification is sent, the alert is deleted automatically

**CSV Export:**
```csv
Tarih,Fiyat (TL),Ürün
2026-03-20,45999,"Samsung 75U8000F..."
2026-03-21,44500,"Samsung 75U8000F..."
2026-03-24,43999,"Samsung 75U8000F..."
```

(The header columns are Date, Price (TL), Product.)

#### `styles.css` — Widget Styles

**CSS Custom Properties (Theme System):**
```css
Default (Light):
  --bg: #fff
  --border: #e8e8e8
  --text: #222
  --muted: #999

Dark (when the .tpt-dark class is added):
  --bg: #1c1c1c
  --border: #333
  --text: #e0e0e0
  --muted: #777
```

The theme preference is stored with `chrome.storage.local`, and the same theme is used on all sites.

#### `popup.html` + `popup.js` — Extension Popup Panel

The panel that opens when the extension icon is clicked:
- Subscription status (FREE/PRO badge)
- Active product info (if on a product page)
- Statistics: number of tracked products, total data points, how many days tracked
- List of tracked products (click → go to the product, × → stop tracking)
- Pro upgrade / cancel
- List of supported sites

The popup lists the products in `chrome.storage.local` together with the products on the server (if the server is running). The "Aktif ürün" ("Active product") card extracts the prefixed ID (`ty-`/`hb-`/`az-`, using the same rules as content.js) from the tab URL and fetches its history with `GET_HISTORY`. Clicking a product in the list opens the right site based on the ID prefix:
- `ty-{ID}` → `https://www.trendyol.com/x/x-p-{ID}`
- `hb-{ID}` → `https://www.hepsiburada.com/x-p-{ID}`
- `az-{ASIN}` → `https://www.amazon.com.tr/dp/{ASIN}`

Known limitations:
- Trendyol and Hepsiburada links are built with an `x` placeholder instead of the real product slug; it is assumed the site redirects this address to the right product (not verified in a browser).
- On Hepsiburada, if the ID was taken from the `data-product-id` attribute rather than the URL, the "Aktif ürün" card can't match this product from the URL.
- For products coming from the server, the "how many days tracked" statistic isn't calculated (`/api/products` doesn't return the first record date) and the × delete button isn't shown (the server has no delete endpoint).

#### `server/server.js` — Backend API (Optional)

A simple REST API based on Express.js. Data is stored in a JSON file, and the last 90 days are kept. The port is hard-coded (3000); the extension also connects to `http://localhost:3000/api`. History entries in server records don't include the product name (the name is stored at the product level).

| Endpoint | Method | Description |
|---|---|---|
| `/api/track` | POST | Save price (`{ productId, name, price }`) |
| `/api/history?productId=xxx` | GET | Product price history |
| `/api/products` | GET | All tracked products |

Data file: `server/data/prices.json`

> **Note:** If the server isn't running, the extension automatically uses `chrome.storage.local`. The server is entirely optional.

---

## Features

### Core
- Automatic price detection and saving on the product page
- Price history chart (Chart.js)
- Lowest / Highest / Percentage change statistics
- Price direction indicator (up/down arrow)
- Product image shown in the widget

### Advanced
- Target price alert + Chrome notification
- Price prediction trend (linear regression)
- Installment calculator (3/6/9/12 months)
- Comparison of other sellers' prices
- CSV export
- Draggable widget (position is remembered)
- Light/Dark theme support

### Multi-Site
- Trendyol
- Hepsiburada
- Amazon TR

### Freemium Model
| Feature | Free | Pro |
|---|---|---|
| Price tracking | Yes | Yes |
| Chart | Last 7 days | Last 30 days |
| Prediction | Yes | Yes |
| Installment calculator | Yes | Yes |

In the code, the only difference between Free and Pro is the number of days the chart shows. Although the upgrade box in the widget mentions "gelişmiş istatistikler" ("advanced statistics") and "₺29/ay" ("₺29/month"), there are no separate Pro statistics.

There is no payment integration: the "Pro'ya Yükselt" ("Upgrade to Pro") button saves a `pro` subscription valid for 30 days in `chrome.storage.local`, and "iptal" ("cancel") sets the plan back to `free`. As it stands, this is a demo/placeholder flow.

---

## Installation

### Loading the Extension
1. Go to `chrome://extensions` in Chrome
2. Turn on **Developer mode** in the top right
3. Click the **Load unpacked** button
4. Select the repository folder (the folder containing `manifest.json`)

### Backend Server (Optional)
```bash
cd server
npm install
npm start
```
The server runs at `http://localhost:3000`.

### Demo Data (For Testing)
`seed-demo-data.js` generates random prices for the last 31 days and writes them to `chrome.storage.local` under the prefixed key the extension uses (`price_ty-{ID}`, `price_hb-{ID}` or `price_az-{ASIN}`). To run it:

1. Open a product page on a supported site (Trendyol, Hepsiburada, Amazon TR).
2. Open the DevTools Console; in the context selector at the top (default `top`), choose the extension's content script context ("Fiyat Takip — Trendyol, Hepsiburada & Amazon TR"). `chrome.storage` doesn't exist in the normal page context; in the wrong context the script says so and stops.
3. Paste and run the contents of `seed-demo-data.js`, then reload the page.

> **Note:** If the local server is running, the widget reads history from the server; shut the server down to see the demo data.

---

## Technical Notes

- **Manifest V3**: The modern Chrome Extension standard, Service Worker based
- **XSS Protection**: innerHTML isn't used; all DOM elements are created programmatically
- **SPA Compatibility**: In-page navigation is caught with MutationObserver
- **Fallback System**: If the server can't be reached, `chrome.storage.local` kicks in automatically
- **Data Cleanup**: When a new record is written, records older than 90 days are deleted (both locally and on the server)
- **Price Parsing**: The Turkish format (dot = thousands, comma = decimal) is parsed correctly
- **Selector Fallback**: On Trendyol, if the known CSS selectors fail, it finds the price by scanning spans
