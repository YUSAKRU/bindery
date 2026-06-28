# Quire — Geliştirme Yol Haritası

> Son güncelleme: 2026-06-28
>
> Mevcut durum: 8 araç + okuyucu + Files sort + "Open in tool" tamamlandı,
> cihazda doğrulandı, Play Store dahili testte. Bu doküman **henüz yapılmamış**
> işleri sıralar; geçmiş kararların kaydı değildir.

---

## Tamamlanan (v0.0.1 — v0.0.2 Sprint)

**Araçlar:**
Kitapçık · Birleştir · Sayfa Yönetimi · Döndür · Sayfa Numarası · Filigran ·
Görselden PDF + Perspektif Düzeltme · Dosya Yönetimi

**Okuyucu:**
- Landscape okuyucu: native `@capacitor/screen-orientation`, fit-width, dikey scroll + yatay swipe
- Metin seçme / kopyalama (TextLayer, piksel boyutlu container, clipboard API)
- Belge içi metin arama (TextLayer highlight mekanizması)
- Akıllı gece modu: canvas düzeyinde renk tersine çevirme, görseller hariç
- Gece modu tercihi kalıcı (`@capacitor/preferences`)

**Files tab:**
- Sort: A→Z / Z→A / En yeni / En eski, localStorage ile kalıcı
- "Open in tool": dosyadan doğrudan araç açma (7 araç, iki adımlı modal)

**Kalite & Bug fix:**
- H1: Downloads klasöründen kaydetme/yeniden adlandırma crash düzeltildi
- H2: Blob branch atob crash düzeltildi
- M1: 30 debug console.log production'dan kaldırıldı
- M2–M6: 6 araçta eksik spinner eklendi
- M7: Son Okunanlar sayfa konumu kaydetme/açmada korunuyor
- L2: Okuyucu araç köprüsü hatasında reader bağlamı korunuyor
- L3: listPrivateFolder gerçek hataları yüzeyleniyor
- L4: saveDocConfirmBtn spinner eklendi
- Onboarding: Döndür, Sayfa Numarası, Okuyucu eklendi (8 araç)

---

## Kısa Vade — Tek Kalan Küçük İş

**L1 — Arama sessiz timeout** (`app.ts:2819`)
Yavaş cihaz veya büyük PDF'de 800ms bekle süresi aşılınca arama highlight'ları
sessizce gösterilmiyor. Fix: kullanıcıya "sonuç bulunamadı" veya retry mesajı.
Düşük öncelik, bağımsız iş.

---

## Orta Vade — Yeni Araç

**PDF Bölme (Split)**
Sayfa aralığı seç → yeni dosya oluştur. `organize-engine.ts` altyapısını
paylaşabilir (sayfa seçimi mantığı zaten var). Yeni engine fonksiyonu + yeni UI
ekranı gerekiyor. Önkoşul: testerlardan talep gelmesi.

---

## Mimari — Hazırlık (Fırsatçı)

**`reader-ui.ts` çıkarımı**
`app.ts`'in okuyucu bloğu ~830 satır (2510–3340 arası). Standalone sprint değil —
bir sonraki okuyucu özelliği eklendiğinde hazırlık olarak yapılacak.

Taşınacak fonksiyonlar: `openFullscreenReader`, `closeFullscreenReader`,
`updateFullscreenPages`, `renderFullscreenPageInto`, `setupFullscreenGestures`,
`updateFullscreenOrientation`, `openReaderWithBytes`, `renderReaderList`,
`renderReaderPageInto`, `evictReaderPage`, `runSearch`, `navigateToMatch`,
`applySearchHighlightsOnPage`, `clearSearchHighlights`.

Sonuç: app.ts ~3000 satıra düşer.

---

## Uzun Vade — v1.0 Dağıtım

| Hedef | Ön Koşul | Not |
|---|---|---|
| GitHub mobil repo açık kaynak | Güvenlik kontrolü (keystore, local.properties yok) | Hero thread ile aynı anda |
| F-Droid başvurusu | Capacitor reproducible build süreci | Privacy topluluğunun en büyük güven sinyali |
| Public launch | Play Store + GitHub + F-Droid hazır | Hero thread (TR + EN) + görsel/GIF |

---

## Faz 3 — OCR

| Araç | Teknik Engel | Karar |
|---|---|---|
| **OCR (metin tanıma)** | `tesseract.js` WASM bundle boyutu tehlikeli büyük; mobil performans riski | v2.0'a ertele, kullanıcı talebi kanıtlanana kadar |

---

## Bilinçli Olarak Kapsam Dışı

- **PDF Şifreleme / Şifre Kaldır:** `pdf-lib` şifreleme yazamıyor, `qpdf-wasm` gerekir — ihtiyaç yok.
- **PDF Sıkıştırma:** `pdf-lib` görsel yeniden örnekleme yapamıyor, kalite kaybı riski — ihtiyaç yok.
- **Form doldurma, e-imza:** Regülasyon karmaşıklığı, niş talep.
- **PDF → Word/Excel:** Yüksek karmaşıklık, düşük çıktı kalitesi riski.

---

## Gerçek Soru

Teknik olarak yapılacak kritik bir şey kalmadı. Uygulamanın artık tester ve
geri bildirim alması gerekiyor. **v0.1.0 hedefi için 20 tester / 14 gün süreci**
başlatılmadan kod kalitesi ilerleyemez — kullanıcı verisi olmadan önceliklendirme
kör uçuş olur. Bkz. `docs/LANSMAN_PLAYBOOK.md`.
