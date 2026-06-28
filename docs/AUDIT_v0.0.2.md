# Quire — Kod & Ürün Denetimi (v0.0.2 Sonrası)

> Tarih: 2026-06-27
> Hazırlayan: thinker-mina + thinker-tiki + coder-remi
> Kapsam: UX kalitesi, teknik borç, eksik polish, bug tespiti

---

## Kritik — Deploy Öncesi Düzeltilmeli

### H1 — Downloads klasöründen açılan PDF kaydedilemiyor
**Dosya:** `app.ts:3432`

Kaydetme / yeniden adlandırma akışındaki regex (`/\/(scans|booklets|merges|edits)\//`) `downloads/` klasörünü kapsamıyor. Downloads'tan açılan bir PDF kaydedilmeye çalışıldığında `subDir='scans'` fallback'ine düşüyor, ardından var olmayan bir yolu taşımaya çalışıyor → hata toast'u, işlem başarısız.

**Yeniden üretme:** Download özelliğiyle kaydettiğin bir PDF'i okuyucuda aç → Kaydet / Yeniden Adlandır → hata.

---

### H2 — Blob dönen ortamlarda `readPdfFromUri` çöküyor
**Dosya:** `file-bridge.ts:46`

`Filesystem.readFile()` bazı ortamlarda (web / test) `Blob` döndürüyor. Mevcut kod `Blob.text()` çağırıyor — bu raw binary string, base64 değil. Sonra `atob()` geçersiz base64 aldığı için exception fırlatıyor.

**Etki:** String branch doğru çalışıyor; Blob branch tüm ortamlarda crash yolu.

---

## Yüksek Öncelik — Görünür Kalite Sorunları

### M1 — 37 adet `console.log` production kodunda
**Dosya:** `app.ts` (satırlar: 693, 698, 710, 716, 735, 751, 753, 785, 790, 793, 796, 941, 947, 950, 952, 1196, 1201, 1204, 1207, 1428, 1433, 1436, 1439, 1616, 1621, 1624, 1627, 1837, 1842, 1845, 1848, 3089, 3092, 3128, 3175, 3910, 3918)

`[DEBUG]` ve `[Gestures]` prefiksli loglar production build'de aktif. Gesture loglarından 4'ü pointer-move hot path'inde — her swipe pikselinde tetikleniyor. Performans yükü ve UI iç state'i console'a sızdırıyor.

---

### M2 — Organize: apply sırasında spinner yok
**Dosya:** `app.ts:1216`
Apply butonu disabled oluyor ama görsel geri bildirim yok. Büyük PDF'lerde saniyeler alabilir — kullanıcı dondu mu çalışıyor mu bilemez. Karşılaştırma: `generateBtn` (kitapçık) `app.ts:815-816`'da doğru şekilde spinner gösteriyor.

---

### M3 — Döndür: apply sırasında spinner yok
**Dosya:** `app.ts:1453`
Rotate apply butonu disabled ama spinner yok.

---

### M4 — Sayfa Numarası: apply sırasında spinner yok
**Dosya:** `app.ts:1660`
Page numbers apply butonu disabled ama spinner yok.

---

### M5 — Filigran: apply sırasında spinner yok
**Dosya:** `app.ts:1925`
`watermarkSaveSpinner` yalnızca kaydetme adımında var; apply adımında spinner yok.

---

### M6 — Görsel→PDF: generate sırasında spinner yok
**Dosya:** `app.ts:2182`
`imgGenerateBtn` disabled ama görsel geri bildirim yok. Çok sayıda görselde işlem yavaş olabilir.

---

### M7 — Recents: kaydet/yeniden adlandır sonrası sayfa konumu sıfırlanıyor
**Dosya:** `recents-store.ts:35`

`recordOpened` her çağrıda `lastPage: 1` yazıyor. Kullanıcı 50. sayfadayken kaydederse Son Okunanlar'daki konum 1'e düşüyor — okuyucu tekrar açıldığında başa dönüyor.

---

## Düşük Öncelik

### L1 — Arama: 800ms bekleme sessiz başarısız olabiliyor
**Dosya:** `app.ts:2819-2823`
Sayfa render'ını 50ms aralıklarla max 800ms bekliyor. Yavaş cihaz veya büyük PDF'de 800ms aşılırsa highlight sessizce gösterilmiyor, kullanıcıya geri bildirim yok.

---

### L2 — Okuyucu araç köprüsü hatasında yanlış ekrana dönüyor
**Dosya:** `app.ts:2957`
`goToError(..., 'hub')` çağrısı okuyucu bağlamını ve sayfa konumunu kaybettiriyor. `'reader'` olmalı.

---

### L3 — Files tab: tüm hatalar sessizce yutulup boş klasör gösteriliyor
**Dosya:** `file-bridge.ts:174-188`
`listPrivateFolder` herhangi bir hata (izin reddi, disk doldu vb.) durumunda sessizce `mkdir` deneyip `[]` döndürüyor. Gerçek hata kullanıcıya gösterilmiyor.

---

### L4 — Kaydet onay butonu: spinner yok
**Dosya:** `app.ts:3432` (ikincil)
`saveDocConfirmBtn` disabled oluyor ama spinner gösterilmiyor — diğer kaydetme akışlarıyla tutarsız.

---

## Ürün Gözlemleri (thinker-tiki)

### Onboarding İçeriği Eksik
Onboarding sayfa 2, yalnızca 5 aracı listeliyor: kitapçık, birleştir, organize, filigran, görsel→PDF.
Uygulamada 8 araç var — Döndür, Sayfa Numarası ve Okuyucu (landscape + metin seçme dahil) listelenmemiş. Her yeni kullanıcının ilk izlenimi eksik bir tablo gösteriyor.

---

### Files Tab: Araca Doğrudan Aç Yok
Files tab'da paylaş / taşı / yeniden adlandır / sil mevcut. "Araçta aç" yok. Kullanıcı bir dosyaya filigran eklemek istediğinde Files'tan Filigran aracına geçip dosyayı tekrar seçmek zorunda. Günlük sürtünme.

---

### Files Tab: Sıralama Yok
Ad / değiştirme tarihi sıralaması yok. Güç kullanıcılar için beklenen temel özellik.

---

## Mimari Not

`app.ts` okuyucu bloğu (~830 satır, 2510–3340 arası) bir sonraki okuyucu özelliği eklendiğinde `reader-ui.ts`'e çıkarılmalı. Standalone refactor sprint değil — bir sonraki okuyucu özelliğine hazırlık olarak yapılmalı. Çıkarılacak fonksiyonlar: `openFullscreenReader`, `closeFullscreenReader`, `updateFullscreenPages`, `renderFullscreenPageInto`, `setupFullscreenGestures`, `updateFullscreenOrientation`, `openReaderWithBytes`, `renderReaderList`, `renderReaderPageInto`, `evictReaderPage`, `runSearch`, `navigateToMatch`, `applySearchHighlightsOnPage`, `clearSearchHighlights`. Sonuç: app.ts ~3000 satıra düşer.

---

## Önerilen Sıra

| Öncelik | İş | Efor |
|---|---|---|
| 1 | H1 + H2 kritik bug fix | 2-3 saat |
| 2 | M1 debug log temizliği + M7 lastPage fix + L2 reader hata yönlendirmesi | 1-2 saat |
| 3 | M2-M6 spinner eksikleri (6 araç) | 2-3 saat |
| 4 | Onboarding güncelleme | 1 saat |
| 5 | Files "Open in tool" | 4-6 saat |
| 6 | Files sıralama | 2 saat |
