# Fiyat Takip — Chrome Extension v2.0

Trendyol, Hepsiburada ve Amazon TR ürün sayfalarında fiyat geçmişini takip eden, grafik olarak gösteren ve akıllı alışveriş kararları vermenize yardımcı olan Chrome uzantısı.

---

## Proje Yapısı

```
chormePriceExtens/
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
        ├── Fiyat kaydedilir (API veya chrome.storage.local)
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
  - trendyol:    -p-{ID} URL pattern, .prc-dsc fiyat selector  → ID: ty-{ID}
  - hepsiburada: -p-{ID} veya data-product-id attribute        → ID: hb-{ID}
  - amazon:      /dp/{ASIN} URL pattern                        → ID: az-{ASIN}
```

Ürün ID'leri site önekiyle (`ty-`, `hb-`, `az-`) saklanır, böylece farklı sitelerdeki aynı numaralar çakışmaz.

Her adapter şu methodları sağlar:
- `getProductId()` → Ürün ID çıkarma
- `getProductName()` → Ürün adı çıkarma
- `getProductPrice()` → Fiyat çıkarma (Türkçe format: 43.999,00 TL)
- `getProductImage()` → Ürün görseli URL'i
- `getOtherSellers()` → Diğer satıcıların fiyatları (Amazon adapter'ı boş liste döner)

**Fiyat Parse Sistemi (parseTRPrice):**
```
Girdi: "43.999,50 TL"
  → Harf/sembol temizle: "43.999,50"
  → Noktaları sil (binlik ayırıcı): "43999,50"
  → Virgülü noktaya çevir: "43999.50"
  → parseFloat: 43999.5
```

Trendyol adapter'ında bilinen selector'lar fiyatı bulamazsa, fallback olarak sayfadaki tüm `<span>` elementlerini tarar ve fiyat class'ı taşıyan bir elementin içindeki TL fiyat pattern'ına uyan değeri alır. Hepsiburada ve Amazon adapter'larında bu fallback yoktur.

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

Tahmin en az 3 veri noktası olduğunda gösterilir; yanında "güncel fiyat + eğim" olarak hesaplanan bir sonraki fiyat tahmini yazar.

#### `background.js` — Service Worker (Arka Plan)

Tüm veri işlemleri ve API iletişimi burada gerçekleşir.

**Mesaj Sistemi:**
Content script ve popup, background.js ile `chrome.runtime.sendMessage` üzerinden haberleşir.

| Mesaj Tipi | Yön | Açıklama |
|---|---|---|
| `TRACK_PRICE` | content → bg | Fiyat kaydı |
| `GET_HISTORY` | content/popup → bg | Fiyat geçmişi getir |
| `GET_SERVER_PRODUCTS` | popup → bg | Sunucudaki ürün listesi (sunucu kapalıysa boş) |
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

Storage key formatı: `price_{productId}` (örn. `price_ty-123456`)
Her ürün için array: `[{ date: "2026-03-24", price: 43999, name: "Samsung..." }, ...]`

Aynı gün içinde tekrar kayıt gelirse o günün kaydı güncellenir (günde bir veri noktası).

> **Dikkat:** API'ye kayıt başarılı olursa veri yalnızca sunucuya yazılır, `chrome.storage.local`'e yazılmaz. Bu yüzden popup ve periyodik alarm kontrolü geçmişi önce sunucudan okur (`GET_HISTORY` / `GET_SERVER_PRODUCTS`), sunucu kapalıysa yerel veriye düşer. Yerel ve sunucu kayıtları birbirine senkronize edilmez.

**Alarm Sistemi:**
- Kullanıcı widget'tan hedef fiyat belirler
- Ürün sayfası her açıldığında (`TRACK_PRICE`) güncel fiyat hedefle karşılaştırılır
- Ayrıca `chrome.alarms` ile her 4 saatte bir kontrol yapılır; bu kontrol sayfaları yeniden çekmez, son kayıtlı fiyata bakar (sunucu açıksa sunucudan, değilse yerelden)
- Fiyat hedefe eşit veya altındaysa `chrome.notifications` ile bildirim gönderilir
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

Popup `chrome.storage.local` içindeki ürünleri ve (sunucu çalışıyorsa) sunucudaki ürünleri birlikte listeler. "Aktif ürün" kartı sekme URL'inden önekli ID'yi (`ty-`/`hb-`/`az-`, content.js ile aynı kurallarla) çıkarıp geçmişi `GET_HISTORY` ile alır. Listedeki bir ürüne tıklamak ID önekine göre doğru siteyi açar:
- `ty-{ID}` → `https://www.trendyol.com/x/x-p-{ID}`
- `hb-{ID}` → `https://www.hepsiburada.com/x-p-{ID}`
- `az-{ASIN}` → `https://www.amazon.com.tr/dp/{ASIN}`

Bilinen kısıtlar:
- Trendyol ve Hepsiburada linkleri gerçek ürün slug'ı yerine `x` yer tutucusuyla kurulur; sitenin bu adresi doğru ürüne yönlendirdiği varsayılır (tarayıcıda doğrulanmadı).
- Hepsiburada'da ID URL'den değil `data-product-id` attribute'undan alındıysa, "Aktif ürün" kartı bu ürünü URL'den eşleştiremez.
- Sunucudan gelen ürünler için "kaç gündür takip" istatistiği hesaplanmaz (`/api/products` ilk kayıt tarihini döndürmez) ve × silme butonu gösterilmez (sunucuda silme uç noktası yok).

#### `server/server.js` — Backend API (Opsiyonel)

Express.js tabanlı basit REST API. Veriler JSON dosyasında saklanır, son 90 gün tutulur. Port koda sabit yazılmıştır (3000); uzantı da `http://localhost:3000/api` adresine bağlanır. Sunucu kayıtlarında geçmiş girdileri ürün adı içermez (ad ürün seviyesinde tutulur).

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

Kodda Free ile Pro arasındaki tek fark grafiğin gösterdiği gün sayısıdır. Widget'taki yükseltme kutusu "gelişmiş istatistikler" ve "₺29/ay" yazsa da ayrı bir Pro istatistiği yoktur.

Ödeme entegrasyonu yoktur: "Pro'ya Yükselt" butonu `chrome.storage.local` içinde 30 gün geçerli bir `pro` aboneliği kaydeder, "iptal" ise planı tekrar `free` yapar. Bu şu haliyle bir demo/yer tutucu akıştır.

---

## Kurulum

### Uzantıyı Yükleme
1. Chrome'da `chrome://extensions` adresine git
2. Sağ üstten **Geliştirici modu**'nu aç
3. **Paketlenmemiş öğe yükle** butonuna tıkla
4. Depo klasörünü (`manifest.json` dosyasının bulunduğu klasör) seç

### Backend Sunucu (Opsiyonel)
```bash
cd server
npm install
npm start
```
Sunucu `http://localhost:3000` adresinde çalışır.

### Demo Veri (Test İçin)
`seed-demo-data.js`, son 31 gün için rastgele fiyatlar üretip `chrome.storage.local`'e, uzantının kullandığı önekli anahtara (`price_ty-{ID}`, `price_hb-{ID}` veya `price_az-{ASIN}`) yazar. Çalıştırmak için:

1. Desteklenen bir sitede (Trendyol, Hepsiburada, Amazon TR) bir ürün sayfası aç.
2. DevTools Console'u aç; üstteki bağlam seçicisinden (varsayılan `top`) uzantının content script bağlamını seç ("Fiyat Takip — Trendyol, Hepsiburada & Amazon TR"). `chrome.storage` normal sayfa bağlamında yoktur; yanlış bağlamda script bunu söyleyip durur.
3. `seed-demo-data.js` içeriğini yapıştırıp çalıştır, sonra sayfayı yenile.

> **Not:** Yerel sunucu çalışıyorsa widget geçmişi sunucudan okur; demo veriyi görmek için sunucuyu kapat.

---

## Teknik Notlar

- **Manifest V3**: Modern Chrome Extension standardı, Service Worker tabanlı
- **XSS Koruması**: innerHTML kullanılmaz, tüm DOM elementleri programatik oluşturulur
- **SPA Uyumluluğu**: MutationObserver ile sayfa içi navigasyon yakalanır
- **Fallback Sistemi**: Sunucu erişilemezse `chrome.storage.local` otomatik devreye girer
- **Veri Temizliği**: Yeni kayıt yazılırken 90 günden eski kayıtlar silinir (hem yerelde hem sunucuda)
- **Fiyat Parsing**: Türkçe format (nokta=binlik, virgül=ondalık) doğru parse edilir
- **Selector Fallback**: Trendyol'da bilinen CSS selector'lar bulamazsa span'ları tarayarak fiyat bulur
