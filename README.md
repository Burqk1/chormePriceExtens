# Fiyat Takip — Chrome Extension v2.0

Trendyol, Hepsiburada ve Amazon TR ürün sayfalarında fiyat geçmişini takip eden, grafik olarak gösteren ve akıllı alışveriş kararları vermenize yardımcı olan Chrome uzantısı.

---

## Proje Yapısı

```
chormeexten/
│
├── manifest.json            ← Uzantı tanım dosyası (Manifest V3)
├── background.js            ← Service Worker — arka plan işlemleri
├── content.js               ← Ürün sayfasına enjekte edilen ana script
├── styles.css               ← Widget stil dosyası (light/dark tema)
├── popup.html               ← Uzantı ikonu tıklanınca açılan panel
├── popup.js                 ← Popup panel mantığı
├── seed-demo-data.js        ← Test için demo veri oluşturma scripti
├── generate-icons.html      ← İkon oluşturma yardımcı sayfası
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── lib/
│   └── chart.min.js         ← Chart.js v4.4.7 (grafik kütüphanesi)
│
└── server/                  ← Opsiyonel backend API
    ├── package.json
    └── server.js
```

---

## Sistem Mimarisi

### Genel Akış

```
Kullanıcı ürün sayfasını açar
        │
        ▼
   content.js çalışır
        │
        ├── Site tespiti (Trendyol / Hepsiburada / Amazon TR)
        ├── Ürün ID, isim, fiyat, görsel çekilir
        ├── Widget sayfaya enjekte edilir
        │
        ▼
   background.js'e mesaj gönderilir
        │
        ├── Fiyat kaydedilir (API veya localStorage)
        ├── Geçmiş verisi çekilir
        ├── Abonelik durumu kontrol edilir
        │
        ▼
   Widget güncellenir
        │
        ├── İstatistikler hesaplanır
        ├── Grafik çizilir (Chart.js)
        ├── Tahmin yapılır
        ├── Taksit hesaplanır
        └── Diğer satıcılar listelenir
```

### Dosya Bazında Detay

#### `manifest.json` — Uzantı Tanımı
- **Manifest V3** formatında
- Desteklenen siteler: `trendyol.com`, `hepsiburada.com`, `amazon.com.tr`
- İzinler: `storage`, `activeTab`, `tabs`, `alarms`, `notifications`
- Content script olarak `chart.min.js` ve `content.js` yüklenir
- `background.js` Service Worker olarak çalışır

#### `content.js` — Ana İçerik Scripti (Sayfa İçi)

Bu dosya ürün sayfasına otomatik enjekte edilir ve tüm kullanıcı arayüzünü oluşturur.

**Multi-Site Adapter Sistemi:**
```
SITE tespit edilir (hostname'e göre)
        │
        ▼
Her site için ayrı adapter objesi var:
  - trendyol:    -p-{ID} URL pattern, .prc-dsc fiyat selector
  - hepsiburada: -p-{ID} veya data-product-id attribute
  - amazon:      /dp/{ASIN} URL pattern
```

Her adapter şu methodları sağlar:
- `getProductId()` → Ürün ID çıkarma
- `getProductName()` → Ürün adı çıkarma
- `getProductPrice()` → Fiyat çıkarma (Türkçe format: 43.999,00 TL)
- `getProductImage()` → Ürün görseli URL'i
- `getOtherSellers()` → Diğer satıcıların fiyatları

**Fiyat Parse Sistemi (parseTRPrice):**
```
Girdi: "43.999,50 TL"
  → Harf/sembol temizle: "43.999,50"
  → Noktaları sil (binlik ayırıcı): "43999,50"
  → Virgülü noktaya çevir: "43999.50"
  → parseFloat: 43999.5
```

Eğer bilinen selector'lar fiyatı bulamazsa, fallback olarak sayfadaki tüm `<span>` elementlerini tarar ve TL fiyat pattern'ına uyan olanı alır.

**Widget Oluşturma:**
- Tüm DOM elementleri JavaScript ile oluşturulur (innerHTML kullanılmaz — XSS güvenliği)
- `mk()` helper fonksiyonu ile element oluşturma
- `svgIcon()` ile SVG ikonlar DOMParser üzerinden parse edilir

**Sürükleme (Drag & Drop):**
- Header'dan tutularak widget sürüklenebilir
- Pozisyon `chrome.storage.local` ile kaydedilir
- Sayfa yenilendiğinde aynı pozisyonda açılır

**SPA Navigation:**
- `MutationObserver` ile DOM değişiklikleri izlenir
- URL değiştiğinde widget kaldırılır ve yeni ürün için tekrar oluşturulur
- Trendyol gibi SPA sitelerde sayfa yenilenmeden geçişleri yakalar

**Fiyat Tahmini (Linear Regression):**
```
Son 7 veri noktasına basit lineer regresyon uygulanır:
  slope = (n·ΣXY - ΣX·ΣY) / (n·ΣX² - (ΣX)²)

slope < -1  → "Düşüş trendi — beklemeniz faydalı olabilir"
slope > 1   → "Yükseliş trendi — erken almayı düşünün"
diğer       → "Fiyat stabil görünüyor"
```

#### `background.js` — Service Worker (Arka Plan)

Tüm veri işlemleri ve API iletişimi burada gerçekleşir.

**Mesaj Sistemi:**
Content script ve popup, background.js ile `chrome.runtime.sendMessage` üzerinden haberleşir.

| Mesaj Tipi | Yön | Açıklama |
|---|---|---|
| `TRACK_PRICE` | content → bg | Fiyat kaydı |
| `GET_HISTORY` | content → bg | Fiyat geçmişi getir |
| `GET_SUBSCRIPTION` | content/popup → bg | Abonelik durumu |
| `UPGRADE_PRO` | content/popup → bg | Pro'ya yükselt |
| `DOWNGRADE_FREE` | popup → bg | Free'ye düşür |
| `SET_ALERT` | content → bg | Hedef fiyat alarmı kur |
| `REMOVE_ALERT` | content → bg | Alarmı kaldır |
| `GET_ALERT` | content → bg | Alarm bilgisi getir |
| `EXPORT_CSV` | content → bg | CSV dışa aktarma |

**Veri Depolama (Dual System):**
```
Fiyat kaydı isteği gelir
        │
        ▼
  Backend API'ye POST /api/track dene
        │
    Başarılı? ──Yes──→ Tamam
        │
       No (sunucu kapalı)
        │
        ▼
  chrome.storage.local'e kaydet (fallback)
```

Storage key formatı: `price_{productId}`
Her ürün için array: `[{ date: "2026-03-24", price: 43999, name: "Samsung..." }, ...]`

**Alarm Sistemi:**
- Kullanıcı hedef fiyat belirler
- `chrome.alarms` ile her 4 saatte bir kontrol yapılır
- Fiyat hedefe düşerse `chrome.notifications` ile bildirim gönderilir
- Bildirim gönderildikten sonra alarm otomatik silinir

**CSV Export:**
```csv
Tarih,Fiyat (TL),Ürün
2026-03-20,45999,"Samsung 75U8000F..."
2026-03-21,44500,"Samsung 75U8000F..."
2026-03-24,43999,"Samsung 75U8000F..."
```

#### `styles.css` — Widget Stilleri

**CSS Custom Properties (Tema Sistemi):**
```css
Varsayılan (Light):
  --bg: #fff
  --border: #e8e8e8
  --text: #222
  --muted: #999

Dark (.tpt-dark class eklenince):
  --bg: #1c1c1c
  --border: #333
  --text: #e0e0e0
  --muted: #777
```

Tema tercihi `chrome.storage.local` ile saklanır, tüm sitelerde aynı tema kullanılır.

#### `popup.html` + `popup.js` — Uzantı Popup Paneli

Uzantı ikonuna tıklanınca açılan panel:
- Abonelik durumu (FREE/PRO badge)
- Aktif ürün bilgisi (eğer bir ürün sayfasındaysa)
- İstatistikler: takip edilen ürün sayısı, toplam veri noktası, kaç gündür takip
- Takip edilen ürünler listesi (tıkla → ürüne git, × → takipten kaldır)
- Pro yükseltme / iptal etme
- Desteklenen siteler listesi

#### `server/server.js` — Backend API (Opsiyonel)

Express.js tabanlı basit REST API. Veriler JSON dosyasında saklanır.

| Endpoint | Method | Açıklama |
|---|---|---|
| `/api/track` | POST | Fiyat kaydı (`{ productId, name, price }`) |
| `/api/history?productId=xxx` | GET | Ürün fiyat geçmişi |
| `/api/products` | GET | Tüm takip edilen ürünler |

Veri dosyası: `server/data/prices.json`

> **Not:** Sunucu çalışmıyorsa uzantı otomatik olarak `chrome.storage.local` kullanır. Sunucu tamamen opsiyoneldir.

---

## Özellikler

### Temel
- Ürün sayfasında otomatik fiyat tespiti ve kayıt
- Fiyat geçmişi grafiği (Chart.js)
- En düşük / En yüksek / Değişim yüzdesi istatistikleri
- Fiyat yönü göstergesi (yukarı/aşağı ok)
- Ürün görseli widget'ta gösterilir

### Gelişmiş
- Hedef fiyat alarmı + Chrome bildirimi
- Fiyat tahmin trendi (lineer regresyon)
- Taksit hesaplayıcı (3/6/9/12 ay)
- Diğer satıcı fiyatları karşılaştırması
- CSV dışa aktarma
- Sürüklenebilir widget (pozisyon hatırlanır)
- Light/Dark tema desteği

### Çoklu Site
- Trendyol
- Hepsiburada
- Amazon TR

### Freemium Model
| Özellik | Free | Pro |
|---|---|---|
| Fiyat takibi | Var | Var |
| Grafik | Son 7 gün | Son 30 gün |
| Tahmin | Var | Var |
| Taksit hesap | Var | Var |
| Gelişmiş istatistik | — | Var |

---

## Kurulum

### Uzantıyı Yükleme
1. Chrome'da `chrome://extensions` adresine git
2. Sağ üstten **Geliştirici modu**'nu aç
3. **Paketlenmemiş öğe yükle** butonuna tıkla
4. `chormeexten` klasörünü seç

### Backend Sunucu (Opsiyonel)
```bash
cd server
npm install
npm start
```
Sunucu `http://localhost:3000` adresinde çalışır.

### Demo Veri (Test İçin)
Ürün sayfasında F12 → Console'a `seed-demo-data.js` içeriğini yapıştırıp Enter'a bas, sonra sayfayı yenile.

---

## Teknik Notlar

- **Manifest V3**: Modern Chrome Extension standardı, Service Worker tabanlı
- **XSS Koruması**: innerHTML kullanılmaz, tüm DOM elementleri programatik oluşturulur
- **SPA Uyumluluğu**: MutationObserver ile sayfa içi navigasyon yakalanır
- **Fallback Sistemi**: Sunucu erişilemezse localStorage otomatik devreye girer
- **Veri Temizliği**: 90 günden eski kayıtlar otomatik silinir
- **Fiyat Parsing**: Türkçe format (nokta=binlik, virgül=ondalık) doğru parse edilir
- **Selector Fallback**: Bilinen CSS selector'lar bulamazsa tüm span'ları tarayarak fiyat bulur
