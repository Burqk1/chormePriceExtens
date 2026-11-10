

// Kullanım: ürün sayfasında DevTools Console'u aç, bağlam seçicisinden (varsayılan "top")
// uzantının content script bağlamını seç ("Fiyat Takip — Trendyol, Hepsiburada & Amazon TR"),
// bu dosyanın içeriğini yapıştırıp çalıştır, sonra sayfayı yenile.
// Not: yerel sunucu (server/) çalışıyorsa widget geçmişi sunucudan okur ve bu demo veri görünmez.
(async function seedDemoData() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    console.error("chrome.storage yok: Console bağlamını uzantının content script'i olarak seçin.");
    return;
  }

  // content.js adapter'larıyla aynı önekli ID kuralları
  const h = window.location.hostname;
  const path = window.location.pathname;
  let m = null;
  let productId = null;
  if (h.includes("trendyol")) {
    m = path.match(/-p-(\d+)/);
    if (m) productId = "ty-" + m[1];
  } else if (h.includes("hepsiburada")) {
    m = path.match(/-p-([A-Za-z0-9]+)/);
    if (m) productId = "hb-" + m[1];
    else {
      const el = document.querySelector("[data-product-id]");
      if (el) productId = "hb-" + el.getAttribute("data-product-id");
    }
  } else if (h.includes("amazon.com.tr")) {
    m = path.match(/\/dp\/([A-Z0-9]+)/);
    if (m) productId = "az-" + m[1];
  }
  if (!productId) {
    console.error("Not on a product page!");
    return;
  }

  const basePrice = 500;
  const history = [];

  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const variation = Math.sin(i * 0.5) * 80 + (Math.random() - 0.5) * 40;
    const price = Math.round((basePrice + variation) * 100) / 100;
    history.push({ date: dateStr, price });
  }

  const key = "price_" + productId;
  await chrome.storage.local.set({ [key]: history });
  console.log("Seeded " + history.length + " price entries for product " + productId);
  console.log("Reload the page to see the chart.");
})();
