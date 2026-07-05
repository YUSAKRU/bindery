# Bindery: All-in-One PDF Tools

**Language / Dil:**
- [English](#-english)
- [Türkçe](#-türkçe)

---

<a name="-english"></a>
## English

Bindery is a privacy-focused, **fully offline** PDF toolkit that runs entirely on your mobile device.

### Why Offline / Privacy-Focused?

The app manifest doesn't request the internet permission — every PDF operation (merging, page management, conversion) happens **entirely locally, on your device's CPU**. Your files never leave your device; nothing is uploaded to a server, and nothing is shared with any analytics or tracking service.

### Features

- **Booklet Maker** — Turns a PDF into a foldable booklet layout
- **PDF Merge** — Combines multiple PDFs into a single file
- **Page Management** — Add, delete, and reorder pages
- **Page Rotation**
- **Page Numbering**
- **Watermarking**
- **Image-to-PDF + Perspective Correction** — Create PDFs from photos with automatic perspective correction
- **Built-in PDF Reader**:
  - Night mode (canvas-level smart color inversion)
  - Text selection / copying
  - In-document text search
  - Resume from last-read page (recents resume-to-page)
- **Local File Folders** — Sorting in the Files tab and opening tools directly from a file

### Screenshots

<!-- Big Boss: Add real app screenshots here, e.g.:
![Home Screen](docs/media/screenshot-home.png)
![Booklet Tool](docs/media/screenshot-booklet.png)
![Reader - Night Mode](docs/media/screenshot-reader-night.png)
-->

### Development & Build

#### Quick Start: Test, Build & Deploy to Device

```bash
npm run test && npm run build && \
export JAVA_HOME=/opt/android-studio/jbr && \
export ANDROID_HOME=$HOME/Android/Sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

#### Step by Step

1. **Run tests**: `npm run test`
2. **Build**: `npm run build` (output: `dist/`)
3. **Deploy to device**:
   ```bash
   export JAVA_HOME=/opt/android-studio/jbr
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools

   npx cap sync
   npx cap run android
   ```

See [`CLAUDE.md`](CLAUDE.md) for more details.

### License

This project is licensed under **GPL-3.0**. See [`LICENSE`](LICENSE) for the full text and [`LICENSING.md`](LICENSING.md) for the rationale behind this license choice.

---

<a name="-türkçe"></a>
## Türkçe

Bindery, mobil cihazınızda çalışan, gizlilik odaklı, **tamamen çevrimdışı** bir PDF araç setidir.

### Neden Çevrimdışı / Gizlilik Odaklı?

Uygulama manifestosu internet iznini talep etmez — tüm PDF işleme, birleştirme, sayfa düzenleme ve dönüştürme işlemleri **cihazınızın CPU'sunda, tamamen yerel olarak** gerçekleşir. Dosyalarınız hiçbir zaman cihazınızdan çıkmaz; hiçbir sunucuya yüklenmez, hiçbir analitik/izleme servisiyle paylaşılmaz.

### Özellikler

- **Kitapçık (Booklet) Oluşturucu** — PDF'i katlanabilir kitapçık düzenine getirir
- **PDF Birleştir** — Birden fazla PDF'i tek dosyada birleştirir
- **Sayfa Yönetimi** — Sayfa ekleme, silme, yeniden sıralama
- **Sayfa Döndürme**
- **Sayfa Numarası Ekleme**
- **Filigran (Watermark) Ekleme**
- **Görselden PDF + Perspektif Düzeltme** — Fotoğraflardan PDF oluşturma, otomatik perspektif düzeltme
- **Dahili PDF Okuyucu**:
  - Gece modu (canvas seviyesinde akıllı renk tersine çevirme)
  - Metin seçme / kopyalama
  - Belge içi metin arama
  - Son okunan sayfadan devam etme (recents resume-to-page)
- **Yerel Dosya Klasörleri** — Files sekmesinde sıralama ve dosyadan doğrudan araç açma

### Ekran Görüntüleri

<!-- Big Boss: Gerçek uygulama ekran görüntülerini buraya ekleyin, örnek:
![Ana Ekran](docs/media/screenshot-home.png)
![Kitapçık Aracı](docs/media/screenshot-booklet.png)
![Okuyucu - Gece Modu](docs/media/screenshot-reader-night.png)
-->

### Geliştirme & Derleme

#### Hızlı Başlangıç: Test, Build & Cihaza Deploy

```bash
npm run test && npm run build && \
export JAVA_HOME=/opt/android-studio/jbr && \
export ANDROID_HOME=$HOME/Android/Sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

#### Adım Adım

1. **Test çalıştır**: `npm run test`
2. **Build oluştur**: `npm run build` (çıktı: `dist/`)
3. **Cihaza deploy et**:
   ```bash
   export JAVA_HOME=/opt/android-studio/jbr
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools

   npx cap sync
   npx cap run android
   ```

Detaylı bilgi için [`CLAUDE.md`](CLAUDE.md) dosyasına bakın.

### Lisans

Bu proje **GPL-3.0** ile lisanslanmıştır. Tam metin için [`LICENSE`](LICENSE) dosyasına, lisans seçim gerekçesi için [`LICENSING.md`](LICENSING.md) dosyasına bakın.
