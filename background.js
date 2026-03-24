const API_BASE = "http://localhost:3000/api";

// --- Subscription ---
async function getSubscription() {
  const result = await chrome.storage.local.get("subscription");
  return result.subscription || { plan: "free", expiresAt: null };
}

async function setSubscription(plan, durationDays = 30) {
  const expiresAt = Date.now() + durationDays * 86400000;
  await chrome.storage.local.set({ subscription: { plan, expiresAt } });
}

// --- API with local fallback ---
async function trackPrice(productData) {
  try {
    const res = await fetch(`${API_BASE}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
    });
    if (res.ok) return await res.json();
  } catch {}
  return saveLocalPrice(productData);
}

async function fetchHistory(productId) {
  try {
    const res = await fetch(`${API_BASE}/history?productId=${productId}`);
    if (res.ok) return await res.json();
  } catch {}
  return getLocalHistory(productId);
}

async function saveLocalPrice(data) {
  const key = `price_${data.productId}`;
  const result = await chrome.storage.local.get(key);
  const history = result[key] || [];
  const today = new Date().toISOString().slice(0, 10);

  const existingIndex = history.findIndex((e) => e.date === today);
  const entry = { date: today, price: data.price, name: data.name };

  if (existingIndex >= 0) {
    history[existingIndex] = entry;
  } else {
    history.push(entry);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const filtered = history.filter((e) => new Date(e.date) >= cutoff);

  await chrome.storage.local.set({ [key]: filtered });
  return { success: true, source: "local" };
}

async function getLocalHistory(productId) {
  const key = `price_${productId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

async function getAlerts() {
  const result = await chrome.storage.local.get("price_alerts");
  return result.price_alerts || {};
}

async function setAlert(productId, targetPrice, productName) {
  const alerts = await getAlerts();
  alerts[productId] = { targetPrice, productName, createdAt: Date.now() };
  await chrome.storage.local.set({ price_alerts: alerts });
}

async function removeAlert(productId) {
  const alerts = await getAlerts();
  delete alerts[productId];
  await chrome.storage.local.set({ price_alerts: alerts });
}

async function checkAlerts(productId, currentPrice) {
  const alerts = await getAlerts();
  const alert = alerts[productId];
  if (!alert) return null;
  if (currentPrice <= alert.targetPrice) {
    chrome.notifications.create(`price-alert-${productId}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Fiyat Düştü!",
      message: `${alert.productName}\nHedef: ₺${alert.targetPrice.toLocaleString("tr-TR")}\nŞimdi: ₺${currentPrice.toLocaleString("tr-TR")}`,
    });
    await removeAlert(productId);
    return { fired: true, targetPrice: alert.targetPrice };
  }
  return { fired: false, targetPrice: alert.targetPrice };
}

function generateCSV(history, productName) {
  const header = "Tarih,Fiyat (TL),Ürün";
  const rows = history.map((e) => `${e.date},${e.price},"${productName || ""}"`);
  return header + "\n" + rows.join("\n");
}

chrome.alarms.create("price-check", { periodInMinutes: 240 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "price-check") return;

  const alerts = await getAlerts();
  const productIds = Object.keys(alerts);
  if (!productIds.length) return;

  for (const productId of productIds) {
    const history = await getLocalHistory(productId);
    if (history.length) {
      const lastPrice = history[history.length - 1].price;
      await checkAlerts(productId, lastPrice);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TRACK_PRICE") {
    trackPrice(message.data).then(async (result) => {
      if (message.data.productId && message.data.price) {
        await checkAlerts(message.data.productId, message.data.price);
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "GET_HISTORY") {
    fetchHistory(message.productId).then(sendResponse);
    return true;
  }

  if (message.type === "GET_SUBSCRIPTION") {
    getSubscription().then(sendResponse);
    return true;
  }

  if (message.type === "UPGRADE_PRO") {
    setSubscription("pro", 30).then(() => {
      sendResponse({ success: true, plan: "pro" });
    });
    return true;
  }

  if (message.type === "DOWNGRADE_FREE") {
    setSubscription("free", 0).then(() => {
      sendResponse({ success: true, plan: "free" });
    });
    return true;
  }

  if (message.type === "SET_ALERT") {
    setAlert(message.productId, message.targetPrice, message.productName).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "REMOVE_ALERT") {
    removeAlert(message.productId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_ALERT") {
    getAlerts().then((alerts) => {
      sendResponse(alerts[message.productId] || null);
    });
    return true;
  }

  if (message.type === "EXPORT_CSV") {
    fetchHistory(message.productId).then((history) => {
      const csv = generateCSV(history, message.productName);
      sendResponse({ csv });
    });
    return true;
  }
});
