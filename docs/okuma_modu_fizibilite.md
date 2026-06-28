# Landscape Okuyucu — Mimari Karar & İmplementasyon Şartnamesi

> Son güncelleme: 2026-06-27
> Durum: **Karar verildi — Yaklaşım A uygulanacak**

Bu doküman, yatay ekran yönü (landscape), tam ekran (distraction-free) ve yatay
kaydırma (horizontal swipe) özelliklerinin teknik analizini ve alınan uygulama
kararını içerir.

---

## Karar Özeti

**Seçilen yaklaşım:** Native ekran yönü yönetimi (`@capacitor/screen-orientation`)

**Gerekçe:** CSS pseudo-landscape (Yaklaşım B) dokunmatik koordinat kayması ve
sistem UI uyumsuzluğu nedeniyle production'a uygun değildir. Detaylar aşağıda.

---

## Değerlendirilen Yaklaşımlar

### Yaklaşım A: `@capacitor/screen-orientation` (Seçilen)

**Nasıl çalışır:**
1. `android/AndroidManifest.xml`'deki `android:screenOrientation="portrait"` kaldırılır, `"fullUser"` yapılır.
2. Uygulama başlangıcında kod ile portrait kilitlenir.
3. Okuyucuya girildiğinde: `ScreenOrientation.unlock()` veya `lock({ orientation: 'any' })`.
4. Okuyucudan çıkıldığında: `ScreenOrientation.lock({ orientation: 'portrait' })`.

**Avantajlar:**
- Touch koordinatları WebView çevirmediği için sorunsuz çalışır.
- Sistem UI (status bar, navigasyon) otomatik adapte olur.
- GPU native rotation — düşük FPS riski yok.

**Dezavantaj:**
- 1 adet ek NPM bağımlılığı (resmi Capacitor paketi).

---

### Yaklaşım B: CSS Pseudo-Landscape (Reddedildi)

**Neden reddedildi:**

| Sorun | Detay |
|---|---|
| Dokunmatik koordinat kayması | Ekran dikey, görsel 90° döndürülmüş → kullanıcı sağa kaydırırken WebView yukarı hareketi algılar. X/Y eksenlerini matematiksel dönüştürmek gerekir — bakımı imkânsız bir touch mimarisi. |
| Sistem UI uyumsuzluğu | Status bar ve navigasyon tuşları dikey kenarda kalır; kullanıcı deneyimi bozulur. |
| Performans | CSS `transform` GPU yükü Yaklaşım A'ya göre yüksek. |

---

## Karşılaştırma Tablosu

| Metrik | Yaklaşım A (Seçilen) | Yaklaşım B (Reddedilen) |
|---|---|---|
| Geliştirme Maliyeti | Düşük | Çok yüksek |
| Kullanıcı Deneyimi | Mükemmel | Zayıf |
| Performans (FPS) | Yüksek (GPU native) | Orta |
| Yeni NPM Bağımlılığı | 1 (resmi Capacitor) | Yok |
| Touch Güvenilirliği | Sorunsuz | Koordinat kayması riski |

---

## İmplementasyon Planı

### Adım 1 — Plugin Kurulumu

```bash
npm install @capacitor/screen-orientation
npx cap sync
```

### Adım 2 — Manifest Güncellemesi

`android/app/src/main/AndroidManifest.xml` içinde:

```xml
<!-- Eski -->
android:screenOrientation="portrait"

<!-- Yeni -->
android:screenOrientation="fullUser"
```

### Adım 3 — Uygulama Başlangıcında Portrait Kilidi

`src/main.ts` veya uygulama init noktasında:

```typescript
import { ScreenOrientation } from '@capacitor/screen-orientation';
await ScreenOrientation.lock({ orientation: 'portrait' });
```

### Adım 4 — Okuyucu Giriş/Çıkışı

```typescript
// Okuyucuya girerken
await ScreenOrientation.unlock();

// Okuyucudan çıkarken
await ScreenOrientation.lock({ orientation: 'portrait' });
```

### Adım 5 — 3-Sayfa Yatay Buffer

DOM'da yalnızca 3 `.reader-page` container'ı tutulur:
`[Önceki Sayfa] [Aktif Sayfa] [Sonraki Sayfa]`

- Kullanıcı sağa/sola sürüklediğinde `translate3d` ile tüm blok kayar.
- Swipe tamamlandığında aktif sayfa indeksi değişir, DOM güncellenir.
- PDFJS yalnızca o anki ekran çözünürlüğünde tek canvas render eder → bellek minimumda.

**Neden 3-sayfa buffer?** Tüm sayfaları DOM'a yüklemek (mevcut dikey okuyucu
yaklaşımı) büyük belgede RAM tüketir. Yatay modda tek canvas render edildiği için
bellek kullanımı dikey moda göre belirgin biçimde düşer.

### Adım 6 — Distraction-Free UI

```css
.reader-landscape .top-bar,
.reader-landscape .bottom-bar,
.reader-landscape .controls {
  display: none;
}

.reader-landscape .menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: none;
}

.reader-landscape.menu-visible .menu-overlay {
  display: block;
}
```

Kullanıcı ekrana tek dokunduğunda `.menu-visible` sınıfı toggle edilir.

---

## Tahmini Efor

| Adım | Süre |
|---|---|
| Plugin + manifest | 0.5 gün |
| Giriş/çıkış kilitlemesi + test | 0.5 gün |
| 3-sayfa buffer + swipe | 2–3 gün |
| Distraction-free UI + edge case'ler | 1 gün |
| **Toplam** | **4–5 gün** |
