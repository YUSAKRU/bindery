# Quire — Proje Analizi

> Tarih: 2026-06-27
> Hazırlayan: Thinker ajanları (Mina + Tiki)
> Kapsam: Teknik mimari, rekabet, kullanıcı kazanımı, önceliklendirme, dağıtım

---

## 1. Projenin Özü

**Problem:** PDF araçları ya bulut bağımlısı (dosyalar sunucuya gider), ya devasa
masaüstü programı, ya da reklam / upsell labirenti.

**Quire'ın cevabı:** Tamamen çevrimdışı + hepsi bir arada + açık kaynak kombinasyonu.
Android'de bu üçünü birden sunan rakip yok.

**Temel güç:** "Dosyan hiç cihazından çıkmaz" iddiası teknik olarak doğrulanabilir
(ağ izni yok) ve çoğu rakip bunu yapısal olarak sunamaz.

---

## 2. Teknik Mimari

### Katman Yapısı

```
src/
  engine/    → Saf TypeScript PDF mantığı (pdf-lib ile yazma)
  native/    → Capacitor köprüsü (dosya I/O, kamera, "Open with")
  ui/        → app.ts — tüm ekranlar, state, event handler'lar
  i18n/      → Dil yönetimi
```

**Engine katmanı:** 9 engine dosyası, her biri kendi `.test.ts`'i ile. 34 test.
Capacitor'dan tamamen bağımsız — saf TypeScript, vitest ile çalışır.

**Native katman:** Capacitor plugin'leri için ince sarmalayıcılar. Dosya
okuma/yazma, kamera, paylaşma, deep link (App → "PDF ile aç").

**UI katmanı:** `app.ts` — 4209 satır tek dosya. Tüm screen navigasyonu,
durum yönetimi ve event handler'lar burada. En büyük teknik bakım riski.

### Kütüphane Ayrımı

| Kütüphane | Görev | Sınır |
|---|---|---|
| `pdf-lib` | PDF oluşturma ve düzenleme | Şifreleme yazma desteği yok |
| `pdfjs-dist` | PDF render (canvas) + okuyucu | 500kB+ chunk; TextLayer entegre değil |

Bu ayrım doğru ve kasıtlı: pdf-lib yazmak için, pdfjs okumak için.

### Mevcut Kısıtlar

| İstek | Engel |
|---|---|
| Şifrele / şifre kaldır | `pdf-lib` yazma şifrelemesi yok → `qpdf-wasm` gerekir |
| Sıkıştır | `pdf-lib` görsel yeniden örnekleme yapamıyor → canvas re-encode riski |
| Metin arama / kopyalama | TextLayer yok → okuyucu mimarisini yeniden yazmak gerekir |
| OCR | `tesseract.js` bundle boyutunu tehlikeli büyütür |

---

## 3. Rekabet Analizi

| Rakip | Temel Sorun |
|---|---|
| Adobe Acrobat Reader | Hesap zorunlu, agresif upsell |
| iLovePDF / SmallPDF | Online — dosya sunucuya gider, tam bu problem |
| WPS Office | Şişirilmiş, veri gizliliği endişeleri |
| MuPDF | Açık kaynak ama sadece okuma, düzenleme yok |
| CamScanner | Perspektif warp UX'i üstün, bulut bağlantılı |
| Xodo | İyi okuyucu, varsayılan bulut senkronizasyonu |

**Quire'ın gerçek giriş noktası:** "CamScanner kadar iyi tarar, ama dosyan
cihazında kalır." Booklet özelliği ise Android'de neredeyse yoktur — akademisyen,
eğitimci, zin üreticisi nişi.

**Pazar büyüklüğü notu:** "Gizlilik odaklı PDF güç kullanıcısı" gerçek ama
küçük bir segment. Gizlilik önceliğinin 2–3 yılda tablo stakes haline geleceği
öngörüsüne dayalı uzun vadeli bir bahis — makul.

---

## 4. Kullanıcı Kazanımı — 20 Tester / 14 Gün

**Mevcut playbook (LANSMAN_PLAYBOOK.md) sağlam.** İki kritik eksiklik giderildi:

**1. Retention buffer:** 20 değil, 30–35 kişiye davet gönder. Kabul edip
yükleme yapmayan olacak. Takip tablosu zorunlu.

**2. Nudge stratejisi:** 7. günde küçük bir güncelleme notu gönder. Testerlar
unutur — build-in-public sesi bunu doğal yapar, spam gibi görünmez.

**Kanal hız sıralaması:**
1. r/AndroidAppTesters + test-exchange Discord'ları (en hızlı dönüşüm)
2. r/fossandroid (en iyi uzun vadeli fit, ağır ısınır)
3. r/SideProject (etkileşim kolay, tester dönüşümü düşük)
4. X / Threads direkt ağ (kalite > miktar)

---

## 5. Önceliklendirme Kararı

**Ne Faz 2 ne Faz 3 — önce Landscape Okuyucu (Faz 1.5).**

Gerekçe:
- Fizibilite analizi tamamlandı, karar verildi (Yaklaşım A — bkz. `okuma_modu_fizibilite.md`)
- TextLayer gerektirmiyor (Faz 2'nin ağır kısmı)
- 4–5 günlük iş
- Günlük kullanım iyileştirmesi → retention driver

**Sonrasında önerilen sıra:**

| Sıra | İş | Gerekçe |
|---|---|---|
| 1 | Landscape okuyucu + yatay swipe | Hazır, hızlı, retention |
| 2 | Metin seçme / kopyalama | TextLayer'ın ilk açılımı |
| 3 | TextLayer arama | Aynı altyapı, tek sprint |
| 4 | Sıkıştırma | Canvas re-encode kalite testi sonrasında |
| 5 | qpdf-wasm spike | Bundle boyutu ölçüldükten sonra karar |
| 6 | OCR | v2.0'a ertele, kullanıcı talebi kanıtlanana kadar |

**Neden okuyucu önce?** Okuyucu günlük kullanımı → retention. Şifreleme veya
sıkıştırma tek seferlik işlem — kullanıcı yapar ve unutur.

---

## 6. Dağıtım ve Marka

### F-Droid

En yüksek güven sinyali privacy Android topluluğunda. r/fossandroid kitlesi
F-Droid'de olmayan uygulamayı "gerçek FOSS" saymaz.

**Timing:** v1.0 public launch ile birlikte başvur. Capacitor'da reproducible
build süreci zahmetli ama imkânsız değil — önceden hazırlanmaya başla.

### Açık Kaynak Zamanlaması

Masaüstü reponun açık olması "niyet kanıtı" olarak şu an yeterli. Mobil repo
açık kaynağı + GitHub linki, public launch hero thread'i ile aynı anda patla —
tek seferlik en büyük güven sinyali bu.

### Branding Keskinleştirmesi

"Gizlilik öncelikli" sloganı buzzword'e dönüşmekte. Rakiplerin kopyalayamayacağı
**spesifik ve teknik** iddialar kullan:

| Söyleme | Bunun yerine |
|---|---|
| "Gizlilik öncelikli" | "Sıfır ağ çağrısı" |
| "Verileriniz güvende" | "İnternet izni yok — manifest'te görebilirsin" |
| "Çevrimdışı çalışır" | "Cihazının CPU'sunda, hiçbir şey cihazdan çıkmaz" |

Açık kaynak bu iddiaları doğrulanabilir kılar — rakiplerin gizlilik politikasından
10x güçlü güven sinyali.

---

## 7. Teknik Borç Notu

`ui/app.ts` 4209 satır tek dosya. Şu an çalışıyor ama yeni özellik eklendikçe
bakım maliyeti artacak. Acil değil — engine katmanı temiz izole edilmiş olduğu
için bir mantık hatası UI'a sızmaz. Ancak bir sonraki büyük UI değişikliğinde
(landscape okuyucu gibi) doğal fırsat doğarsa modüle etmek değerlendirilebilir.
