(function () {
  "use strict";

  const WIDGET_ID = "tpt-price-tracker";
  let currentProductId = null;
  let chart = null;
  let dragState = null;

  const SITE = (() => {
    const h = location.hostname;
    if (h.includes("trendyol")) return "trendyol";
    if (h.includes("hepsiburada")) return "hepsiburada";
    if (h.includes("amazon.com.tr")) return "amazon";
    return null;
  })();

  const adapters = {
    trendyol: {
      getProductId() {
        const m = location.pathname.match(/-p-(\d+)/);
        return m ? "ty-" + m[1] : null;
      },
      getProductName() {
        const el =
          document.querySelector("h1.pr-new-br span") ||
          document.querySelector("h1.pr-new-br") ||
          document.querySelector(".pr-in-w h1") ||
          document.querySelector("[class*='product-name']") ||
          document.querySelector("h1");
        return el ? el.textContent.trim() : null;
      },
      getProductPrice() {
        const sels = [
          ".prc-dsc",
          ".prc-slg",
          "span.prc-dsc",
          "[class*='prc-dsc']",
          "[class*='prc-slg']",
          "[class*='product-price']",
          ".product-price-container span",
          "[data-testid*='price']",
          "[class*='Price'] span",
          "[class*='price'] span",
        ];
        for (const s of sels) {
          const els = document.querySelectorAll(s);
          for (const el of els) {
            const p = parseTRPrice(el.textContent);
            if (p) return p;
          }
        }
        // Fallback: scan all spans for TL pattern
        const allSpans = document.querySelectorAll("span");
        for (const span of allSpans) {
          const txt = span.textContent.trim();
          if (txt.match(/^\d{1,3}(\.\d{3})*(,\d{2})?\s*TL$/) || txt.match(/^\d{1,3}(\.\d{3})*(,\d{2})?$/)) {
            const parent = span.closest("[class*='prc'], [class*='price'], [class*='Price']");
            if (parent) {
              const p = parseTRPrice(txt);
              if (p && p > 10) return p;
            }
          }
        }
        return null;
      },
      getProductImage() {
        const img =
          document.querySelector(".base-product-image") ||
          document.querySelector(".product-slide img") ||
          document.querySelector("[class*='gallery'] img");
        return img ? img.src : null;
      },
      getOtherSellers() {
        const sellers = [];
        const items = document.querySelectorAll(".other-sellers-item, [class*='merchant-box']");
        items.forEach((item) => {
          const nameEl = item.querySelector("[class*='merchant-name'], [class*='seller-name'], a");
          const priceEl = item.querySelector("[class*='price'], .prc-dsc");
          if (nameEl && priceEl) {
            const price = parseTRPrice(priceEl.textContent);
            if (price) sellers.push({ name: nameEl.textContent.trim(), price });
          }
        });
        return sellers;
      },
    },

    hepsiburada: {
      getProductId() {
        const m = location.pathname.match(/-p-([A-Za-z0-9]+)/);
        if (m) return "hb-" + m[1];
        const el = document.querySelector("[data-product-id]");
        if (el) return "hb-" + el.getAttribute("data-product-id");
        return null;
      },
      getProductName() {
        const el =
          document.querySelector("#product-name") ||
          document.querySelector("h1[data-test-id='product-name']") ||
          document.querySelector("h1");
        return el ? el.textContent.trim() : null;
      },
      getProductPrice() {
        const sels = [
          "[data-test-id='price-current-price']",
          "#offering-price .product-price",
          "[class*='price'] span",
        ];
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el) { const p = parseTRPrice(el.textContent); if (p) return p; }
        }
        return null;
      },
      getProductImage() {
        const img = document.querySelector("[data-test-id='product-image'] img") ||
          document.querySelector(".product-image img");
        return img ? img.src : null;
      },
      getOtherSellers() {
        const sellers = [];
        document.querySelectorAll("[class*='other-sellers'] [class*='merchant']").forEach((item) => {
          const nameEl = item.querySelector("[class*='name']");
          const priceEl = item.querySelector("[class*='price']");
          if (nameEl && priceEl) {
            const price = parseTRPrice(priceEl.textContent);
            if (price) sellers.push({ name: nameEl.textContent.trim(), price });
          }
        });
        return sellers;
      },
    },

    amazon: {
      getProductId() {
        const m = location.pathname.match(/\/dp\/([A-Z0-9]+)/);
        return m ? "az-" + m[1] : null;
      },
      getProductName() {
        const el = document.getElementById("productTitle");
        return el ? el.textContent.trim() : null;
      },
      getProductPrice() {
        const el =
          document.querySelector(".a-price .a-offscreen") ||
          document.querySelector("#priceblock_ourprice") ||
          document.querySelector("#priceblock_dealprice") ||
          document.querySelector(".a-price-whole");
        if (el) return parseTRPrice(el.textContent);
        return null;
      },
      getProductImage() {
        const img = document.getElementById("landingImage") ||
          document.querySelector("#imgBlkFront");
        return img ? img.src : null;
      },
      getOtherSellers() { return []; },
    },
  };

  function parseTRPrice(text) {
    if (!text) return null;
    let raw = text.replace(/[^\d.,]/g, "");
    raw = raw.replace(/\./g, "").replace(",", ".");
    const price = parseFloat(raw);
    return (!isNaN(price) && price > 0) ? price : null;
  }

  function getAdapter() { return SITE ? adapters[SITE] : null; }

  function mk(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "textContent") node.textContent = v;
        else if (k === "className") node.className = v;
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  function svgIcon(markup) {
    const span = document.createElement("span");
    span.style.display = "inline-flex";
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    span.appendChild(document.importNode(doc.documentElement, true));
    return span;
  }

  function send(type, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...data }, resolve);
    });
  }

  function fmt(price) {
    return "\u20BA" + price.toLocaleString("tr-TR");
  }

  const SVG = {
    pulse: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    sun: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    chevron: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    download: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    bell: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
    calc: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>',
    grip: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  };

  function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;

    // Header
    const header = mk("div", { className: "tpt-header", id: "tpt-drag-handle" }, [
      mk("div", { className: "tpt-title" }, [
        svgIcon(SVG.pulse),
        mk("span", { textContent: "Fiyat Takip" }),
      ]),
      mk("div", { className: "tpt-controls" }, [
        (() => { const b = mk("button", { id: "tpt-btn-theme", title: "Tema" }); b.appendChild(svgIcon(SVG.sun)); return b; })(),
        (() => { const b = mk("button", { className: "tpt-btn-collapse", id: "tpt-toggle-collapse", title: "Küçült" }); b.appendChild(svgIcon(SVG.chevron)); return b; })(),
      ]),
    ]);

    // Product row
    const productRow = mk("div", { className: "tpt-product-row", id: "tpt-product-row" }, [
      mk("img", { className: "tpt-product-img", id: "tpt-product-img", alt: "" }),
      mk("div", { className: "tpt-product-detail" }, [
        mk("div", { className: "tpt-product-name", id: "tpt-product-name" }),
        mk("div", { className: "tpt-product-price-row" }, [
          mk("span", { className: "tpt-current-price", id: "tpt-current-price" }),
          mk("span", { className: "tpt-trend-icon", id: "tpt-trend-icon" }),
        ]),
      ]),
    ]);

    // Stats (3 cols)
    function statBox(label, valueId) {
      return mk("div", { className: "tpt-stat" }, [
        mk("span", { className: "tpt-stat-label", textContent: label }),
        mk("span", { className: "tpt-stat-value", id: valueId, textContent: "\u2014" }),
      ]);
    }
    const stats = mk("div", { className: "tpt-stats" }, [
      statBox("En Düşük", "tpt-lowest"),
      statBox("En Yüksek", "tpt-highest"),
      statBox("Değişim", "tpt-change"),
    ]);

    // Prediction row
    const prediction = mk("div", { className: "tpt-prediction", id: "tpt-prediction" });
    prediction.style.display = "none";

    // Chart
    const chartWrap = mk("div", { className: "tpt-chart-wrap" }, [
      mk("canvas", { id: "tpt-chart" }),
    ]);

    // Sellers
    const sellersWrap = mk("div", { className: "tpt-sellers", id: "tpt-sellers" });
    sellersWrap.style.display = "none";

    // Installment calculator
    const installmentWrap = mk("div", { className: "tpt-installment", id: "tpt-installment" }, [
      mk("div", { className: "tpt-section-label" }, [
        svgIcon(SVG.calc),
        mk("span", { textContent: "Taksit Hesapla" }),
      ]),
      mk("div", { className: "tpt-installment-grid", id: "tpt-installment-grid" }),
    ]);

    // Alert
    const alertRow = mk("div", { className: "tpt-alert-row", id: "tpt-alert-row" }, [
      svgIcon(SVG.bell),
      mk("input", { className: "tpt-alert-input", id: "tpt-alert-input", type: "number", placeholder: "Hedef fiyat..." }),
      mk("button", { className: "tpt-alert-btn", id: "tpt-alert-btn", textContent: "Ayarla" }),
    ]);
    const alertActive = mk("div", { className: "tpt-alert-active", id: "tpt-alert-active" }, [
      svgIcon(SVG.bell),
      mk("span", { id: "tpt-alert-text" }),
      mk("button", { className: "tpt-alert-remove", id: "tpt-alert-remove", textContent: "Kaldır" }),
    ]);
    alertActive.style.display = "none";

    // Footer actions
    const footerActions = mk("div", { className: "tpt-footer-actions" }, [
      (() => { const b = mk("button", { className: "tpt-action-btn", id: "tpt-export-btn" }); b.appendChild(svgIcon(SVG.download)); b.appendChild(mk("span", { textContent: "CSV" })); return b; })(),
    ]);

    const planBadge = mk("div", { className: "tpt-plan-badge", id: "tpt-plan-badge", textContent: "FREE" });
    const upgradeBox = mk("div", { className: "tpt-upgrade", id: "tpt-upgrade-box" }, [
      mk("p", { textContent: "30 günlük geçmiş ve gelişmiş istatistikler" }),
      mk("button", { className: "tpt-btn-upgrade", id: "tpt-upgrade-btn", textContent: "Pro'ya Yükselt \u2014 \u20BA29/ay" }),
    ]);

    const body = mk("div", { className: "tpt-body", id: "tpt-body" }, [
      productRow, stats, prediction, chartWrap, sellersWrap, installmentWrap,
      alertRow, alertActive, footerActions, planBadge, upgradeBox,
    ]);

    const widget = mk("div", { id: WIDGET_ID }, [header, body]);

    chrome.storage.local.get("tpt_pos", (r) => {
      if (r.tpt_pos) {
        widget.style.top = r.tpt_pos.top;
        widget.style.right = "auto";
        widget.style.left = r.tpt_pos.left;
      }
    });

    document.body.appendChild(widget);

    // Events
    document.getElementById("tpt-btn-theme").addEventListener("click", toggleTheme);
    document.getElementById("tpt-toggle-collapse").addEventListener("click", toggleCollapse);
    document.getElementById("tpt-upgrade-btn").addEventListener("click", handleUpgrade);
    document.getElementById("tpt-alert-btn").addEventListener("click", handleSetAlert);
    document.getElementById("tpt-alert-remove").addEventListener("click", handleRemoveAlert);
    document.getElementById("tpt-export-btn").addEventListener("click", handleExport);

    initDrag(widget);

    chrome.storage.local.get("tpt_theme", (r) => {
      if (r.tpt_theme === "dark") widget.classList.add("tpt-dark");
    });
  }

  function initDrag(widget) {
    const handle = document.getElementById("tpt-drag-handle");
    handle.style.cursor = "grab";

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      handle.style.cursor = "grabbing";
      const rect = widget.getBoundingClientRect();
      dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };

      function onMove(ev) {
        const dx = ev.clientX - dragState.startX;
        const dy = ev.clientY - dragState.startY;
        widget.style.right = "auto";
        widget.style.left = (dragState.origLeft + dx) + "px";
        widget.style.top = (dragState.origTop + dy) + "px";
      }

      function onUp() {
        handle.style.cursor = "grab";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        chrome.storage.local.set({ tpt_pos: { top: widget.style.top, left: widget.style.left } });
        dragState = null;
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function toggleTheme() {
    const w = document.getElementById(WIDGET_ID);
    w.classList.toggle("tpt-dark");
    chrome.storage.local.set({ tpt_theme: w.classList.contains("tpt-dark") ? "dark" : "light" });
    if (currentProductId) refreshData();
  }

  function toggleCollapse() {
    document.getElementById("tpt-body").classList.toggle("tpt-collapsed");
    document.getElementById("tpt-toggle-collapse").classList.toggle("tpt-rotated");
  }

  async function handleUpgrade() {
    const res = await send("UPGRADE_PRO");
    if (res && res.success) await refreshData();
  }

  async function handleSetAlert() {
    const input = document.getElementById("tpt-alert-input");
    const val = parseFloat(input.value);
    if (!val || val <= 0 || !currentProductId) return;
    const adapter = getAdapter();
    await send("SET_ALERT", { productId: currentProductId, targetPrice: val, productName: adapter.getProductName() || "" });
    input.value = "";
    updateAlertUI();
  }

  async function handleRemoveAlert() {
    if (!currentProductId) return;
    await send("REMOVE_ALERT", { productId: currentProductId });
    updateAlertUI();
  }

  async function updateAlertUI() {
    const alert = await send("GET_ALERT", { productId: currentProductId });
    const activeEl = document.getElementById("tpt-alert-active");
    const rowEl = document.getElementById("tpt-alert-row");
    if (alert && alert.targetPrice) {
      activeEl.style.display = "flex";
      rowEl.style.display = "none";
      document.getElementById("tpt-alert-text").textContent = "Hedef: " + fmt(alert.targetPrice);
    } else {
      activeEl.style.display = "none";
      rowEl.style.display = "flex";
    }
  }

  async function handleExport() {
    if (!currentProductId) return;
    const adapter = getAdapter();
    const res = await send("EXPORT_CSV", { productId: currentProductId, productName: adapter.getProductName() || "" });
    if (!res || !res.csv) return;
    const blob = new Blob([res.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fiyat-gecmisi-" + currentProductId + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderInstallment(price) {
    const grid = document.getElementById("tpt-installment-grid");
    grid.textContent = "";

    const months = [3, 6, 9, 12];
    months.forEach((m) => {
      const monthly = Math.ceil(price / m);
      const row = mk("div", { className: "tpt-inst-row" }, [
        mk("span", { className: "tpt-inst-months", textContent: m + " ay" }),
        mk("span", { className: "tpt-inst-price", textContent: fmt(monthly) + "/ay" }),
      ]);
      grid.appendChild(row);
    });

    document.getElementById("tpt-installment").style.display = "block";
  }

  function renderSellers(sellers) {
    const wrap = document.getElementById("tpt-sellers");
    wrap.textContent = "";
    if (!sellers || !sellers.length) { wrap.style.display = "none"; return; }

    const label = mk("div", { className: "tpt-section-label", textContent: "Diğer Satıcılar" });
    wrap.appendChild(label);

    sellers.slice(0, 5).forEach((s) => {
      const row = mk("div", { className: "tpt-seller-row" }, [
        mk("span", { className: "tpt-seller-name", textContent: s.name }),
        mk("span", { className: "tpt-seller-price", textContent: fmt(s.price) }),
      ]);
      wrap.appendChild(row);
    });

    wrap.style.display = "block";
  }

  function renderPrediction(history, currentPrice) {
    const predEl = document.getElementById("tpt-prediction");
    if (!history || history.length < 3) { predEl.style.display = "none"; return; }

    const recent = history.slice(-7);
    const n = recent.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    recent.forEach((e, i) => {
      sumX += i;
      sumY += e.price;
      sumXY += i * e.price;
      sumX2 += i * i;
    });
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const nextPrice = currentPrice + slope;

    let text, cls;
    if (slope < -1) {
      text = "Düşüş trendi — beklemeniz faydalı olabilir";
      cls = "tpt-pred-down";
    } else if (slope > 1) {
      text = "Yükseliş trendi — erken almayı düşünün";
      cls = "tpt-pred-up";
    } else {
      text = "Fiyat stabil görünüyor";
      cls = "tpt-pred-stable";
    }

    predEl.textContent = "";
    predEl.className = "tpt-prediction " + cls;
    predEl.appendChild(mk("span", { textContent: text }));

    const nextText = " (Tahmin: " + fmt(Math.round(nextPrice)) + ")";
    predEl.appendChild(mk("span", { className: "tpt-pred-value", textContent: nextText }));
    predEl.style.display = "block";
  }

  function computeStats(history, currentPrice) {
    if (!history.length) return { lowest: currentPrice, highest: currentPrice, change: 0, trend: "stable" };
    const prices = history.map((e) => e.price);
    if (currentPrice) prices.push(currentPrice);
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const oldest = history[0].price;
    const newest = currentPrice || history[history.length - 1].price;
    const change = oldest ? (((newest - oldest) / oldest) * 100).toFixed(1) : 0;

    let trend = "stable";
    if (history.length >= 2) {
      const recent = history.slice(-3).map((e) => e.price);
      if (currentPrice) recent.push(currentPrice);
      const last = recent[recent.length - 1];
      const prev = recent[recent.length - 2];
      if (last < prev) trend = "down";
      else if (last > prev) trend = "up";
    }
    return { lowest, highest, change, trend };
  }

  function renderStats(currentPrice, stats) {
    document.getElementById("tpt-current-price").textContent = fmt(currentPrice);
    document.getElementById("tpt-lowest").textContent = fmt(stats.lowest);
    document.getElementById("tpt-highest").textContent = fmt(stats.highest);

    const changeEl = document.getElementById("tpt-change");
    const pct = parseFloat(stats.change);
    changeEl.textContent = (pct > 0 ? "+" : "") + stats.change + "%";
    changeEl.className = "tpt-stat-value" + (pct > 0 ? " tpt-high" : pct < 0 ? " tpt-low" : "");

    const trendEl = document.getElementById("tpt-trend-icon");
    trendEl.textContent = "";
    if (stats.trend === "up") {
      trendEl.className = "tpt-trend-icon tpt-trend-up";
      trendEl.appendChild(svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'));
    } else if (stats.trend === "down") {
      trendEl.className = "tpt-trend-icon tpt-trend-down";
      trendEl.appendChild(svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>'));
    }
  }

  function renderChart(history, isPro) {
    const canvas = document.getElementById("tpt-chart");
    if (!canvas) return;
    if (chart) chart.destroy();

    const days = isPro ? 30 : 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = history.filter((e) => new Date(e.date) >= cutoff);

    const labels = filtered.map((e) => {
      const d = new Date(e.date);
      return d.getDate() + "/" + (d.getMonth() + 1);
    });
    const data = filtered.map((e) => e.price);

    const isDark = document.getElementById(WIDGET_ID).classList.contains("tpt-dark");
    const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const textColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)";

    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: "#f27a1a",
          backgroundColor: "rgba(242,122,26,0.08)",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "#f27a1a",
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? "#222" : "#fff",
            titleColor: isDark ? "#fff" : "#222",
            bodyColor: isDark ? "#ccc" : "#555",
            borderColor: "#e8e8e8",
            borderWidth: 1,
            padding: 8,
            displayColors: false,
            callbacks: {
              label: function (ctx) { return fmt(ctx.parsed.y); },
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 }, callback: function (v) { return "\u20BA" + v.toLocaleString("tr-TR"); } } },
        },
      },
    });
  }

  async function refreshData() {
    const adapter = getAdapter();
    if (!adapter) return;

    const productId = adapter.getProductId();
    if (!productId) return;

    const name = adapter.getProductName() || "Bilinmeyen Ürün";
    const price = adapter.getProductPrice();
    if (!price) return;

    currentProductId = productId;
    createWidget();

    document.getElementById("tpt-product-name").textContent = name;

    const imgUrl = adapter.getProductImage();
    const imgEl = document.getElementById("tpt-product-img");
    if (imgUrl) { imgEl.src = imgUrl; imgEl.style.display = "block"; }
    else { imgEl.style.display = "none"; }

    await send("TRACK_PRICE", { data: { productId, name, price } });

    const history = await send("GET_HISTORY", { productId });
    const sub = await send("GET_SUBSCRIPTION");
    const isPro = sub && sub.plan === "pro" && (!sub.expiresAt || sub.expiresAt > Date.now());

    const badge = document.getElementById("tpt-plan-badge");
    const upgradeBox = document.getElementById("tpt-upgrade-box");
    if (isPro) {
      badge.textContent = "PRO";
      badge.classList.add("tpt-pro");
      upgradeBox.style.display = "none";
    } else {
      badge.textContent = "FREE";
      badge.classList.remove("tpt-pro");
      upgradeBox.style.display = "block";
    }

    const stats = computeStats(history || [], price);
    renderStats(price, stats);
    renderChart(history || [], isPro);
    renderInstallment(price);
    renderPrediction(history || [], price);
    updateAlertUI();

    // Other sellers
    const sellers = adapter.getOtherSellers();
    renderSellers(sellers);
  }

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const old = document.getElementById(WIDGET_ID);
      if (old) old.remove();
      if (chart) { chart.destroy(); chart = null; }
      currentProductId = null;
      setTimeout(() => {
        const adapter = getAdapter();
        if (adapter && adapter.getProductId()) refreshData();
      }, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const initAdapter = getAdapter();
  if (initAdapter && initAdapter.getProductId()) {
    const iv = setInterval(() => {
      if (initAdapter.getProductPrice()) {
        clearInterval(iv);
        refreshData().catch(() => {});
      }
    }, 500);
    setTimeout(() => clearInterval(iv), 15000);
  }
})();
