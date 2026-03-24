

(async function seedDemoData() {
  const productId = window.location.pathname.match(/-p-(\d+)/)?.[1];
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
