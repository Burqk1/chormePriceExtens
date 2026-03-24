const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data", "prices.json");

// Ensure data directory exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize data file
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}), "utf8");
}

app.use(cors());
app.use(express.json());

// --- Helpers ---
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// --- POST /api/track ---
app.post("/api/track", (req, res) => {
  const { productId, name, price } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: "productId and price are required" });
  }

  const db = readDB();
  if (!db[productId]) {
    db[productId] = { name, history: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const hist = db[productId].history;
  const existingIndex = hist.findIndex((e) => e.date === today);
  const entry = { date: today, price: Number(price) };

  if (existingIndex >= 0) {
    hist[existingIndex] = entry;
  } else {
    hist.push(entry);
  }

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  db[productId].history = hist.filter((e) => new Date(e.date) >= cutoff);
  db[productId].name = name || db[productId].name;

  writeDB(db);
  res.json({ success: true, source: "server" });
});

// --- GET /api/history ---
app.get("/api/history", (req, res) => {
  const { productId } = req.query;

  if (!productId) {
    return res.status(400).json({ error: "productId is required" });
  }

  const db = readDB();
  const product = db[productId];

  if (!product) {
    return res.json([]);
  }

  res.json(product.history);
});

// --- GET /api/products ---
app.get("/api/products", (_req, res) => {
  const db = readDB();
  const products = Object.entries(db).map(([id, data]) => ({
    productId: id,
    name: data.name,
    entries: data.history.length,
    lastPrice: data.history.length ? data.history[data.history.length - 1].price : null,
  }));
  res.json(products);
});

app.listen(PORT, () => {
  console.log(`Price Tracker API running on http://localhost:${PORT}`);
});
