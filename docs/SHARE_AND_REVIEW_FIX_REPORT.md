# Bindery — Paylaşım ve Google Play Değerlendirme Sorunları Raporu

**Tarih:** 2026-10-01  
**Sürüm:** 0.6.0 (`release/0.6.0`)  
**İncelenen Alanlar:** "Bindery'yi Paylaş", "Google Play'de Değerlendir", İnceleme Bildirim Diyaloğu (`growthReviewDialog`)  

---

## 1. Tespit Edilen Hatalar ve Kök Neden Analizi

### Hata 1: Yanlış Google Play Paket Kimliği (Package ID)
* **Kök Neden:**  
  `src/native/review-hook.ts` ve `src/i18n/index.ts` dosyalarında Google Play mağaza bağlantısı `com.yusakru.bindery` olarak girilmişti:
  ```ts
  export const STORE_URL = 'https://play.google.com/store/apps/details?id=com.yusakru.bindery';
  ```
  Oysa projenin gerçek ve Google Play'de yayınlanan resmi paket kimliği:
  ```
  com.eduplayconnect.bindery
  ```
  Resmi mağaza adresi: `https://play.google.com/store/apps/details?id=com.eduplayconnect.bindery`
* **Etkisi:** Hem Ayarlar ekranındaki değerlendirme butonuna basıldığında hem de paylaşılan metinlerdeki link tıklandığında Google Play Store üzerinde **404 / "Öğe bulunamadı"** hatası alınıyordu.

---

### Hata 2: Android WebView İçinde `window.open(..., '_blank')` Çağrısının Yutulması
* **Kök Neden:**  
  `openStoreListing` fonksiyonu mağaza linkini açmak için `window.open(STORE_URL, '_blank')` kullanıyordu.
  Android Capacitor WebView yapılandırmasında çoklu pencere desteği (`setSupportMultipleWindows`) etkin olmadığı veya özel popup yöneticisi bulunmadığı için `window.open` çağrıları native Android katmanı tarafından yakalanmayıp sessizce yok sayılmaktaydı.
* **Çözüm:**  
  Doğrudan `window.location.href = STORE_URL` ataması yapıldı. Capacitor'ün `BridgeWebViewClient` katmanı (`shouldOverrideUrlLoading`), alan adı `localhost` dışına çıktığında bunu algılayarak harici `Intent.ACTION_VIEW` intent'i fırlatır. Bu sayede Android sistemi linki doğrudan **Google Play Store uygulamasına** (veya cihaz tarayıcısına) yönlendirir.

---

### Hata 3: `shareBinderyApp` Argüman Sırası Tersliği
* **Kök Neden:**  
  `src/native/file-bridge.ts` içindeki `shareText` fonksiyonu şu imzaya sahiptir:
  ```ts
  export async function shareText(text: string, title: string): Promise<ShareOutcome>
  ```
  Ancak `src/native/review-hook.ts` içinde çağrı ters argümanlarla yapılıyordu:
  ```ts
  // Hatalı çağrı:
  await shareText(title, text);
  ```
* **Etkisi:** Paylaşım metninde başlık ile gövde yer değiştiriyor, WhatsApp, Telegram gibi uygulamalar başlık alanını göz ardı ettiği için mağaza linkini içeren esas metin kaybolabiliyordu. Doğru sıralama olan `shareText(text, title)` şeklinde düzeltildi.

---

### Hata 4: `index.html`'deki Kapatılmamış `<div>` Nedeniyle Oluşan Görünmez Modal Kilidi
* **Kök Neden:**  
  `v0.5.2` sürümünde `<dialog id="growthReviewDialog">` eklenirken, hemen üzerindeki `signatureInfoSheet` div'ini kapatan iki adet `</div>` yanlışlıkla silinmişti. Bu nedenle diyalog, `display: none` olan gizli bir kapsayıcının içine yerleşmişti.
  Kitapçık kaydedildiğinde `growthReviewDialog.showModal()` çağrıldığında:
  * Diyalog 0x0 boyutunda görünmez kaldı.
  * Fakat tarayıcının *top-layer* modal katmanı aktifleşerek tüm ekranı kaplayan görünmez bir tıklama engelleme katmanı (backdrop) oluşturdu.
  * Kullanıcı ekrandaki butonları ("Kaydedildi ✓", "Konuma Git", "Paylaş", vb.) görmesine rağmen hiçbir yere dokunamıyor, uygulama kilitlenmiş gibi görünüyordu.
* **Çözüm:**  
  Eksik `</div></div>` etiketleri tamamlandı, diyalog gövdeye taşındı, tema uyumlu CSS stilleri eklendi ve karartma alanına tıklandığında diyaloğun kapanması sağlandı.

---

## 2. Yapılan Değişiklikler

1. **`src/native/review-hook.ts`**:
   * `STORE_URL` ve `MARKET_URI` değerleri `com.eduplayconnect.bindery` olarak güncellendi.
   * `openStoreListing` fonksiyonunda `window.location.href = STORE_URL` yönlendirmesine geçildi.
   * `shareBinderyApp` içinde `shareText(text, title)` argüman sırası düzeltildi.
2. **`src/i18n/index.ts`**:
   * Türkçe ve İngilizce `growth.shareText` metinlerindeki paket kimliği `com.eduplayconnect.bindery` yapıldı.
3. **`src/native/review-hook.test.ts`**:
   * Testler yeni doğru parametre sırasını ve `window.location.href` yönlendirmesini doğrulayacak şekilde güncellendi (tüm testler yeşil).
4. **`index.html`**:
   * `signatureInfoSheet` kapanış etiketleri düzeltildi.
5. **`src/ui/styles.css`**:
   * `dialog.modal-sheet`, `::backdrop`, `.modal-sheet-content`, `.modal-sheet-actions` stilleri eklendi.
6. **`src/ui/app.ts`**:
   * `growthReviewDialog` dışına tıklandığında diyaloğu kapatan dinleyici eklendi.

---

## 3. Doğrulama Durumu

* **Vitest Test Paketi:** 33 dosya, 827 test — **Tamamı BAŞARILI (YEŞİL)**.
* **TypeScript:** `npx tsc --noEmit` — **0 hata**.
* **Vite & Rollup Build:** `npm run build` — **Temiz derleme**.
* **Linter:** `npm run lint` — **0 hata**.
