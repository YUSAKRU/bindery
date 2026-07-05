# Quire: All-in-One PDF Tools

Quire, mobil cihazınızda çalışan, gizlilik odaklı, **tamamen çevrimdışı** bir PDF araç setidir.

## Neden Çevrimdışı / Gizlilik Odaklı?

Uygulama manifestosu internet iznini talep etmez — tüm PDF işleme, birleştirme, sayfa düzenleme ve dönüştürme işlemleri **cihazınızın CPU'sunda, tamamen yerel olarak** gerçekleşir. Dosyalarınız hiçbir zaman cihazınızdan çıkmaz; hiçbir sunucuya yüklenmez, hiçbir analitik/izleme servisiyle paylaşılmaz.

## Özellikler

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

## Ekran Görüntüleri

<!-- Big Boss: Gerçek uygulama ekran görüntülerini buraya ekleyin, örnek:
![Ana Ekran](docs/media/screenshot-home.png)
![Kitapçık Aracı](docs/media/screenshot-booklet.png)
![Okuyucu - Gece Modu](docs/media/screenshot-reader-night.png)
-->

## Geliştirme & Derleme

### Hızlı Başlangıç: Test, Build & Cihaza Deploy

```bash
npm run test && npm run build && \
export JAVA_HOME=/opt/android-studio/jbr && \
export ANDROID_HOME=/home/user/Android/Sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

### Adım Adım

1. **Test çalıştır**: `npm run test`
2. **Build oluştur**: `npm run build` (çıktı: `dist/`)
3. **Cihaza deploy et**:
   ```bash
   export JAVA_HOME=/opt/android-studio/jbr
   export ANDROID_HOME=/home/user/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools

   npx cap sync
   npx cap run android
   ```

Detaylı bilgi için [`CLAUDE.md`](CLAUDE.md) dosyasına bakın.

## Lisans

Bu proje **GPL-3.0** ile lisanslanmıştır. Tam metin için [`LICENSE`](LICENSE) dosyasına, lisans seçim gerekçesi için [`docs/LICENSE.md`](docs/LICENSE.md) dosyasına bakın.
