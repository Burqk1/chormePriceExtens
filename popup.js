// Ürün ID'sini (ty-/hb-/az- önekli) sekme URL'inden çıkarır; content.js adapter'larıyla aynı kurallar
function productIdFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname;
  let m;
  if (h.includes("trendyol")) {
    m = u.pathname.match(/-p-(\d+)/);
    return m ? "ty-" + m[1] : null;
  }
  if (h.includes("hepsiburada")) {
    m = u.pathname.match(/-p-([A-Za-z0-9]+)/);
    return m ? "hb-" + m[1] : null;
  }
  if (h.includes("amazon.com.tr")) {
    m = u.pathname.match(/\/dp\/([A-Z0-9]+)/);
    return m ? "az-" + m[1] : null;
  }
  return null;
}

// Önekli ID'den ürünün kendi sitesindeki adresini üretir
function productUrl(id) {
  if (id.startsWith("hb-")) return "https://www.hepsiburada.com/x-p-" + id.slice(3);
  if (id.startsWith("az-")) return "https://www.amazon.com.tr/dp/" + id.slice(3);
  if (id.startsWith("ty-")) return "https://www.trendyol.com/x/x-p-" + id.slice(3);
  return "https://www.trendyol.com/x/x-p-" + id; // eski, öneksiz kayıtlar
}

document.addEventListener("DOMContentLoaded", async () => {
  const sub = await chrome.runtime.sendMessage({ type: "GET_SUBSCRIPTION" });
  const isPro =
    sub && sub.plan === "pro" && (!sub.expiresAt || sub.expiresAt > Date.now());

  const badge = document.getElementById("badge");
  const upgradeCard = document.getElementById("upgrade-card");
  const manageCard = document.getElementById("manage-card");

  if (isPro) {
    badge.textContent = "PRO";
    badge.classList.add("pro");
    upgradeCard.classList.add("hidden");
    manageCard.classList.add("visible");
    if (sub.expiresAt) {
      document.getElementById("pro-exp").textContent =
        "Bitiş: " + new Date(sub.expiresAt).toLocaleDateString("tr-TR");
    }
  }

  const allData = await chrome.storage.local.get(null);
  const productKeys = Object.keys(allData).filter((k) => k.startsWith("price_"));
  const products = [];
  let totalPoints = 0;
  let oldestDate = null;

  for (const key of productKeys) {
    const history = allData[key];
    if (!Array.isArray(history) || !history.length) continue;
    const last = history[history.length - 1];
    totalPoints += history.length;
    const first = new Date(history[0].date);
    if (!oldestDate || first < oldestDate) oldestDate = first;
    products.push({
      id: key.replace("price_", ""),
      name: last.name || "Ürün #" + key.replace("price_", ""),
      price: last.price,
      entries: history.length,
      local: true,
    });
  }

  // Sunucu modu: yerelde olmayan, sunucuda kayıtlı ürünleri de listele
  const serverProducts = await chrome.runtime.sendMessage({ type: "GET_SERVER_PRODUCTS" });
  if (Array.isArray(serverProducts)) {
    for (const sp of serverProducts) {
      if (!sp.productId || sp.lastPrice == null) continue;
      if (products.some((p) => p.id === sp.productId)) continue;
      totalPoints += sp.entries || 0;
      products.push({
        id: sp.productId,
        name: sp.name || "Ürün #" + sp.productId,
        price: sp.lastPrice,
        entries: sp.entries || 0,
        local: false,
      });
    }
  }

  document.getElementById("s-products").textContent = products.length;
  document.getElementById("s-points").textContent = totalPoints;
  if (oldestDate) {
    document.getElementById("s-days").textContent =
      Math.max(1, Math.ceil((Date.now() - oldestDate.getTime()) / 86400000));
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const pid = productIdFromUrl(tab.url);
      if (pid) {
        // GET_HISTORY sunucu açıksa sunucudan, değilse yerelden okur
        const pd = await chrome.runtime.sendMessage({ type: "GET_HISTORY", productId: pid });
        if (Array.isArray(pd) && pd.length) {
          const last = pd[pd.length - 1];
          const known = products.find((p) => p.id === pid);
          document.getElementById("active").classList.add("visible");
          document.getElementById("active-name").textContent =
            last.name || (known && known.name) || "Ürün #" + pid;
          document.getElementById("active-price").textContent =
            "\u20BA" + last.price.toLocaleString("tr-TR");
        }
      }
    }
  } catch {}

  const listEl = document.getElementById("list");
  const empty = document.getElementById("empty");

  if (products.length) {
    empty.style.display = "none";
    products.sort((a, b) => b.entries - a.entries);

    for (const p of products) {
      const row = document.createElement("div");
      row.className = "item";

      const info = document.createElement("div");
      info.className = "item-info";

      const name = document.createElement("div");
      name.className = "item-name";
      name.textContent = p.name;

      const meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = p.entries + " kayıt";

      info.appendChild(name);
      info.appendChild(meta);

      const price = document.createElement("div");
      price.className = "item-price";
      price.textContent = "\u20BA" + p.price.toLocaleString("tr-TR");

      const del = document.createElement("button");
      del.className = "item-del";
      del.title = "Kaldır";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "12");
      svg.setAttribute("height", "12");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6");
      l1.setAttribute("x2", "6"); l1.setAttribute("y2", "18");
      const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l2.setAttribute("x1", "6"); l2.setAttribute("y1", "6");
      l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
      svg.appendChild(l1);
      svg.appendChild(l2);
      del.appendChild(svg);

      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await chrome.storage.local.remove("price_" + p.id);
        row.style.opacity = "0";
        row.style.transition = "opacity 0.2s";
        setTimeout(() => {
          row.remove();
          if (!listEl.querySelectorAll(".item").length) empty.style.display = "block";
          document.getElementById("s-products").textContent =
            listEl.querySelectorAll(".item").length;
        }, 200);
      });

      row.addEventListener("click", () => {
        chrome.tabs.create({ url: productUrl(p.id) });
      });

      row.appendChild(info);
      row.appendChild(price);
      // Sunucudaki kayıtlar için silme uç noktası yok; yalnızca yerel kayıtlar kaldırılabilir
      if (p.local) row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  document.getElementById("upgrade-btn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "UPGRADE_PRO" });
    badge.textContent = "PRO";
    badge.classList.add("pro");
    upgradeCard.classList.add("hidden");
    manageCard.classList.add("visible");
    document.getElementById("pro-exp").textContent =
      "Bitiş: " + new Date(Date.now() + 30 * 86400000).toLocaleDateString("tr-TR");
  });

  document.getElementById("cancel-btn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "DOWNGRADE_FREE" });
    badge.textContent = "FREE";
    badge.classList.remove("pro");
    upgradeCard.classList.remove("hidden");
    manageCard.classList.remove("visible");
  });
});
