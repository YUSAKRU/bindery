# Quire — Kapsamlı Proje Denetim Raporu

> **Tarih:** 2026-06-29
> **Kapsam:** Tüm kod tabanı (engine, native/Android, UI/i18n, build/config)
> **Yöntem:** 4 paralel ajan denetimi (maze koordinasyon + mide·engine, niko·native, moto·UI)
> **Önceki denetim:** `docs/AUDIT_v0.0.2.md` (2026-06-27) — oradaki H1–H2, M1–M7, L1–L4 düzeltilmiş durumda; bu rapor **güncel durumu** sıfırdan tarar.

---

## 0. Sağlık Göstergeleri (doğrulandı)

| Kontrol | Sonuç |
|---|---|
| `npm run test` | ✅ 38/38 geçiyor |
| `npx tsc --noEmit` | ✅ Temiz (exit 0) |
| `npm audit` | ✅ 0 güvenlik açığı |
| Keystore / şifre sızıntısı | ✅ `.jks` ve `local.properties` gitignore'da, güvende |

**Genel değerlendirme:** Proje sağlam ve sevkiyata yakın. Kritik çökme bug'ları yok; bulunanlar çoğunlukla **bellek yönetimi, doğrulama eksikleri, i18n boşlukları ve mimari teknik borç**. En büyük tekil risk: `app.ts`'in 4336 satırlık tek-fonksiyon yapısı ve mobilde PDF render bellek sızıntıları.

Toplam **~95 bulgu**: 12 Yüksek · ~30 Orta · ~40 Düşük · 11 eksik özellik.
Satır düzeyinde detay: `docs/_audit/{engines,native,ui,architecture}.md`.

---

## 1. 🔴 YÜKSEK ÖNCELİK — Sevkiyat Öncesi Ele Alınmalı

### Y1 — Mobilde PDF render bellek sızıntıları (OOM riski)
**Dosya:** `src/native/pdf-thumbnails.ts:11,29` · `src/native/pdf-reader-render.ts:187`

İki ayrı sızıntı:
- `pdf-thumbnails.ts` `getDocument()`'in döndürdüğü `loadingTask`'ı tutmuyor. `PDFDocumentProxy.destroy()` worker düzeyi kaynakları **bırakmaz**; sadece `loadingTask.destroy()` bırakır. Her küçük resim üretiminde worker belleği birikiyor. (`pdf-reader-render.ts:23` bunu doğru yapıyor — örnek alınmalı.)
- Her iki dosyada da `page.render()` sonrası `page.cleanup()` **hiç çağrılmıyor**. pdfjs sayfa başına font/görsel/decode önbelleğini süresiz tutar. Büyük belgelerde mobilde birincil OOM nedeni.

**Etki:** Yüksek. Uzun okuma/çok sayfalı belgede sekme çöker. **Düzeltmesi küçük.**

### Y2 — PDF okuma öncesi dosya boyutu kontrolü yok
**Dosya:** `src/native/file-bridge.ts:41–73` (`readPdfFromUri`, `pickPdf`, `pickPdfs`)

Tüm PDF içeriği `readData:true` ile JS heap'e okunuyor. 150 MB'lık bir PDF, Android WebView heap'ini (~128–256 MB) tüketir. `pickPdfs()` birden çok dosyayı aynı anda yükler, toplam boyut sınırı yok.

**Çözüm:** Okumadan önce `stat.size` kontrol et; eşik üstünü (ör. 50 MB) reddet/uyar.

### Y3 — Sayfa indeksi sınır doğrulaması yok (organize)
**Dosya:** `src/engine/organize-engine.ts:26`

`pageOrder` içindeki sınır dışı (negatif veya `>= sayfaSayısı`) indeksler doğrulanmıyor. `copyPages` tipli `BookletError` yerine ham pdf-lib hatası fırlatıyor → kullanıcıya anlamsız hata.

### Y4 — Perspektif düzeltmede tipsiz hata + doğrulama boşlukları
**Dosya:** `src/engine/perspective-warp.ts:37–39, 64–81`

- `solve8x8` dejenere köşelerde `BookletError` değil düz `Error` fırlatıyor; tipli hata yakalama mekanizmasını es geçiyor.
- `getHomographyMatrix` 4'ten az köşede uzunluk kontrolü yapmadan `undefined` → `NaN` enjekte ediyor; **sessizce yanlış** sonuç (fırlatma yok). Üstelik `warpPerspective` WebGL yolunun **hiç testi yok** (T1).

### Y5 — TypeScript `strict` modu kapalı
**Dosya:** `tsconfig.json`

`noUnusedLocals` vb. açık ama `"strict": true` yok → `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes` kapalı. 4336 satırlık `app.ts`'te yoğun `!` non-null assertion kullanımıyla birlikte bu, gizli null/undefined bug'ları için en büyük zemin. **Kademeli açılmalı** (önce `strictNullChecks`).

### Y6 — `vite.config.ts` yok → kod bölme / chunk yönetimi yok
**Dosya:** proje kökü (eksik dosya)

`pdfjs-dist` (~2 MB) ve `pdf-lib` tek senkron chunk'a düşüyor; soğuk başlangıç yavaş. CLAUDE.md'de not edilen ">500kB chunk" uyarısının kaynağı bu. Ayrıca pdfjs worker'ı açıkça yapılandırılmadığından offline Capacitor'da/CSP'de bozulabilir.

**Çözüm:** `manualChunks` (pdfjs, pdf-lib ayrı) + `chunkSizeWarningLimit` + worker alias içeren bir `vite.config.ts`.

### Y7 — `legacy-dep-removed` runtime bağımlılığında
**Dosya:** `package.json:29`

`legacy-dep-removed` `dependencies` altında ama `src/` içinde hiç import edilmiyor — bu bir MCP sunucu aracı, mobil uygulamada yeri yok. Bundle/çözümleme yükü. **Tamamen kaldırılmalı.**

### Y8 — i18n boşlukları: eksik anahtar + sabit Türkçe stringler
**Dosya:** `src/i18n/index.ts`, `src/ui/app.ts`, `index.html`

- `common.select` anahtarı her iki dilde de yok → kullanıcı butonda ham `"common.select"` metnini görüyor (`index.html:1055`).
- 7 adet sabit Türkçe toast `t()` üzerinden geçmiyor (ör. `"PDF Kaynağı Seçiliyor..."` — `app.ts:815,968,1224,1457,1646,1868`; `'Kaydet'` — `app.ts:1013`). İngilizce dilindeki kullanıcı ham Türkçe görüyor.
- `index.html:939` `"Open in..."` başlığında `data-i18n` yok.

### Y9 — Erişilebilirlik: modallarda ARIA rolü ve focus trap yok
**Dosya:** `index.html:907–1058`, `src/ui/app.ts`

7 modal düz `<div>` — `role="dialog"`, `aria-modal`, `aria-labelledby` yok. Hiç `keydown`/Escape ele alımı yok, sadece 1 `focus()` çağrısı var. Modal açıldığında klavye odağı arkada kalıyor → klavye/switch erişimiyle uygulama kullanılamaz hale geliyor.

---

## 2. 🟡 ORTA ÖNCELİK

### Engine
| # | Dosya:Satır | Bulgu |
|---|---|---|
| O1 | `rotate-engine.ts:19` | Açı ∈ {0,90,180,270} doğrulaması yok; `setRotation(degrees(37))` spec-dışı PDF üretir |
| O2 | `image-to-pdf-engine.ts:18–58` | Dış try/catch iç `BookletError`'u da sarmalıyor; hata tipi kimliği kayboluyor |
| O3 | `watermark-engine.ts:91` | `image.width===0` durumunda `Infinity/NaN` → bozuk sayfa çizimi |
| O4 | `image-to-pdf-engine.ts:22` | `format` runtime guard yok; `webp/gif` gelirse `embedJpg` patlıyor |
| O5 | `download-engine.ts:8` | İndirme öncesi `Content-Type` kontrolü yok; `text/html` yanıt tümüyle indirilip sonra reddediliyor |

### Native / Android
| # | Dosya:Satır | Bulgu |
|---|---|---|
| O6 | `pdf-thumbnails.ts:11` | `bytes` `.slice()` olmadan pdfjs'e veriliyor; ArrayBuffer sahiplik transferi riski (`pdf-reader-render.ts:23` doğru yapıyor) |
| O7 | `recents-store.ts:35` | Son okunanlar dedup'ı `name` ile; farklı klasördeki aynı isimli iki PDF birbirini eziyor — `uri` ile yapılmalı |
| O8 | `file-bridge.ts:42–51` | `content://` URI'de `Filesystem.stat()` güvenilmez isim döndürüyor / bazı sürümlerde patlayıp dosyayı hiç açmıyor |
| O9 | `pdf-reader-render.ts:183` | Gece modunda `canvas:null` + `canvasContext` belgelenmemiş pdfjs kombinasyonu; gelecekte sessizce bozulabilir |
| O10 | `AndroidManifest.xml:50` | Kullanılmayan `CAMERA` izni — runtime prompt + Play Store izin açıklamasında görünür, kaldırılmalı |
| O11 | `res/xml/file_paths.xml` | `files-path` (internal storage) eksik; paylaşımda `FileUriExposedException` riski |
| O12 | `app-links.ts:14` | `appUrlOpen` listener handle atılıyor; tekrar kayıtta (HMR/remount) listener birikip `onUrl` N kez tetikleniyor |
| O13 | `OpenDocumentPlugin.java:46` | `takePersistableUriPermission` başarısızlığı sessiz; süreç ölümünden sonra yeniden açma `SecurityException` veriyor — `persistent:false` flag'i döndürülmeli |
| O14 | `pdf-reader-render.ts:149` | Render iptali yok; hızlı sayfa çevirmede eşzamanlı render'lar ekranı bozuyor (`page.render().cancel()` izlenmeli) |

### UI / Build
| # | Dosya:Satır | Bulgu |
|---|---|---|
| O15 | `app.ts` (mimari) | 80+ iç fonksiyon tek düz closure scope'unda; `organize/rotate/pageNumbers/watermark OriginalName` 5 kez tekrar → genel `ToolScreen<TState>` soyutlaması sinyali |
| O16 | `app.ts:316,891,1092,1250…` | Sabit Türkçe dosya adı ekleri (`'Birlesik_'`, `'_duzenli'`, `'_donduruldu'`, `'_numarali'`, `'_filigranli'`) dilden bağımsız — i18n anahtarı olmalı |
| O17 | `app.ts:337,363,394,437,479` | Türkçe sabit varsayılan değişken adları (`'belge'`, `'Belge'`) |
| O18 | `index.html:1060` | Hata toast'ları `aria-live="polite"`; hatalar için `assertive`/`role="alert"` olmalı |
| O19 | `app.ts:1156,1195,1403` | Küçük resimlerde `alt=""`; satır etiketi `aria-label` ile ilişkilendirilmemiş |
| O20 | `styles.css` | `@media (prefers-reduced-motion: reduce)` bloğu yok (31 animasyon kuralı var) |
| O21 | `app.ts:1056,1296,1533,1744` | Üzerine yazma onayında native `window.confirm()` — JS thread'i bloke eder, i18n'siz, OS-stilli; özel modal kullanılmalı |
| O22 | `app.ts:68` (`PARENT_SCREEN`) | "Geri" sabit ebeveyn haritasıyla araç state'ini koruyamıyor (ör. rotate-result→hub işi kaybettiriyor) |
| O23 | `pdfjs-dist` worker | vite config olmadan worker açıkça kopyalanmıyor/alias'lanmıyor; offline/CSP'de risk |

---

## 3. ⚪ DÜŞÜK ÖNCELİK (özet)

- **Engine:** opacity `<=0` reddi 0'ı dışlıyor (B6); `perspective-warp.ts:152` gereksiz `as any` (B7); booklet `gutter/creep` üst sınırı yok, sayfayı tuval dışına itebiliyor (B8); `page-numbers` `top-left/top-center` eksik (E6); booklet boş dolgu sayfaları son sayfa boyutunu miras alıyor (E7); `merge` `name` alanı kullanılmıyor (E8).
- **Native:** `BROWSABLE` kategorisi gereksiz saldırı yüzeyi (P-3); `capacitor.config.ts`'te `android` bloğu yok → soğuk başta beyaz flaş, `webContentsDebuggingEnabled` belirsiz (P-4); `OpenDocument` plugin'inde iOS/web fallback yok (I-2); launch URL doğrulanmadan `onUrl`'e geçiyor (I-3); arka plana alınan render iptal edilmiyor (R-4).
- **UI:** `app.ts`'te 8 adet `[DEBUG] console.error` production'da (744,823,976,1232,1465,1654,1876,3055); bottom-nav'da `aria-current` yok; `<section>` ekranları etiketsiz; hub arama yalnızca aktif dilde eşleşiyor; "Yeni Dosya" butonları kaydedilmemiş işi onaysız siliyor; galeri input'u klavyeyle erişilemez (`index.html:607`); `vite/vitest` `^` aralıkları geniş.

> Önceki rapordaki **L1 (arama sessiz timeout, `app.ts:2819`)** hâlâ açık tek küçük iş olarak ROADMAP'te listeli.

---

## 4. 🧪 TEST KAPSAM BOŞLUKLARI (öne çıkanlar)

| Öncelik | Boşluk |
|---|---|
| Yüksek | `warpPerspective` WebGL render yolu **0 test** (T1); 4'ten az köşe hata yolu test edilmemiş (T2); `PDFEncryptedError` (şifreli PDF) yolu test edilmemiş (T3) |
| Orta | booklet `gutter/creep` matematiği; organize sınır dışı + tekrarlı indeks; rotate geçersiz açı/0° identity; watermark jpg + sıfır boyut; page-numbers `startNumber>1` ve float |
| Düşük | `computeSheetMapping(0/2)`; opacity 0 sınırı; image-to-pdf jpg; download `arrayBuffer()` reddi |

---

## 5. ➕ EKSİK ÖZELLİKLER (ürün)

| Öncelik | Özellik | Not |
|---|---|---|
| Yüksek | **PDF Bölme (Split)** | Çekirdek özellik; `organize-engine` altyapısını paylaşır (ROADMAP'te orta vade) |
| Yüksek | **Şifreli PDF açma (unlock)** | `validatePdf` şifreliyi reddediyor, kurtarma yolu yok (Not: `pdf-lib` şifre çözemez, `qpdf-wasm` gerekir — ROADMAP'te kapsam dışı sayılmış; en azından net kullanıcı mesajı şart) |
| Orta | PDF sıkıştırma/optimizasyon; PDF metadata editörü; booklet özelleştirilebilir kağıt boyutu (şu an A4 sabit); image→PDF otomatik yatay algılama |
| Düşük | page-numbers ek konumlar + özel font/boyut; watermark sayfa-bazlı seçim; perspektif PNG çıktı seçeneği; booklet çoklu-signature |

---

## 6. 🏗️ MİMARİ ÖNERİ — `app.ts` Bölünmesi

`app.ts` (4336 satır) tek `initApp()` closure'ı: 80+ iç fonksiyon, 147 `addEventListener`, tüm state. Test edilemez ve gezinilemez. moto'nun önerdiği 15 modüllük bölünme:

`ui/shell.ts` · `booklet/merge/organize/rotate/page-numbers/watermark/image-to-pdf/reader/files/recents/settings-screen.ts` · `onboarding.ts` · `pickers.ts` · `save-modal.ts`

Önceki rapor da `reader-ui.ts` çıkarımını (~830 satır, 14 fonksiyon) **fırsatçı** olarak önermişti. Öneri: tek seferlik dev refactor yerine, **bir sonraki özellik dokunulan ekranda o ekranı modüle çıkar** stratejisiyle kademeli ilerle. `strict` modu açmadan önce bu bölünme riski düşürür.

---

## 7. ✅ ÖNERİLEN UYGULAMA SIRASI

| Sıra | İş | Bulgular | Tahmini Efor |
|---|---|---|---|
| 1 | Bellek sızıntıları (loadingTask + page.cleanup + slice) | Y1, O6 | 1-2 saat |
| 2 | Dosya boyutu guard'ı | Y2 | 1 saat |
| 3 | Engine doğrulamaları + tipli hatalar | Y3, Y4, O1–O4 | 2-3 saat |
| 4 | `legacy-dep-removed` kaldır + `vite.config.ts` (chunk + worker) | Y6, Y7, O23 | 2 saat |
| 5 | i18n boşlukları (eksik anahtar + sabit stringler + ekler) | Y8, O16, O17 | 2-3 saat |
| 6 | Erişilebilirlik (modal ARIA + focus trap + Escape) | Y9, O18–O20 | 3-4 saat |
| 7 | Android temizlik (CAMERA izni, file_paths, BROWSABLE, R8) | O10, O11, P-3, P-5 | 1-2 saat |
| 8 | `strict: true` kademeli (önce strictNullChecks) | Y5 | 3-6 saat |
| 9 | Yüksek test boşlukları (perspective, encrypted) | T1–T3 | 2-3 saat |
| 10 | CI pipeline (npm ci → tsc → vitest) | — | 1 saat |
| 11 | Mimari kademeli bölünme (fırsatçı) | §6 | sürekli |

**Öncelik mantığı:** 1-3 doğrudan kullanıcı çökmesi/veri sorunu; 4-5 sevkiyat kalitesi (i18n yanlış dil gösterimi); 6-7 Play Store inceleme + erişilebilirlik; 8-11 sürdürülebilirlik.

> ROADMAP notu hatırlatması: "Teknik olarak kritik bir şey kalmadı, asıl ihtiyaç tester geri bildirimi." Bu rapordaki Y1/Y2 (bellek/OOM) bu görüşü kısmen revize ediyor — **bunlar tester deneyimini doğrudan bozabilir**, tester turundan önce 1-3 sırası önerilir.

---

## Ek — Kaynak Denetim Dosyaları (satır düzeyi detay)
- `docs/_audit/engines.md` — mide (42 bulgu)
- `docs/_audit/native.md` — niko (17 bulgu)
- `docs/_audit/ui.md` — moto (30 bulgu)
- `docs/_audit/architecture.md` — maze (6 bulgu)
