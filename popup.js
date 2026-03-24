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
    });
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
      const m = tab.url.match(/-p-(\d+)/);
      if (m) {
        const pd = allData["price_" + m[1]];
        if (pd && pd.length) {
          const last = pd[pd.length - 1];
          document.getElementById("active").classList.add("visible");
          document.getElementById("active-name").textContent =
            last.name || "Ürün #" + m[1];
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
        chrome.tabs.create({ url: "https://www.trendyol.com/x/x-p-" + p.id });
      });

      row.appendChild(info);
      row.appendChild(price);
      row.appendChild(del);
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
