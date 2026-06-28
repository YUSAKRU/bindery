# Quire — Sosyal Medya & Lansman Oyun Kitabı

> Son güncelleme: 2026-06-27
> Amaç: Quire'ı "Build in Public" yaklaşımıyla, gizlilik-öncelikli kimliğini
> bozmadan tanıtmak; önce kapalı test eşiğini geçmek, sonra public lansmanda
> asıl hikâye thread'ini patlatmak.

---

## 0. Temel Strateji: Mühimmatı Doğru Savaşa Sakla

Origin-story thread'i **tek seferlik en güçlü koz.** Onu, insanlar linke
tıklayıp **anında indirebildiğinde** (public launch) harca. Şu an hedef
yalnızca: 20 tester × 14 gün.

| Aşama | Şu An (Test) | Public Launch |
|---|---|---|
| Amaç | 20 test kullanıcısı × 14 gün kesintisiz opt-in | Geniş erişim + indirme |
| İçerik | Düşük profilli recruitment + build-in-public | Cilalı hero thread (TR + EN) + görsel |
| Kanal | Test takası toplulukları, küçük çevre | X, Threads, Reddit, F-Droid topluluğu |

**Asıl darboğaz:** Yeni kişisel geliştirici hesapları, üretime geçmeden önce
**en az 20 test kullanıcısını 14 gün kesintisiz** opt-in tutmak zorunda.
Kişi sayısı değil, **süreklilik** kritik metrik.

---

## 1. Test Kullanıcısı Recruitment

### 1a. Davet Stratejisi — Retention Buffer

30–35 kişiye davet gönder; bazıları kabul edip yükleme yapmaz. 20 aktifin
garantisi için buffer şart. Basit bir takip tablosu tut:

| Sütun | İçerik |
|---|---|
| Ad / takma ad | |
| Google hesabı e-postası | |
| Davet gönderim tarihi | |
| Yükleme onayı (Evet/Hayır) | |
| 14. gün durumu (Aktif/Düştü) | |

### 1b. 7. Gün Nudge (Zorunlu)

Testerlar unutur. 7. günde küçük bir not gönder:

> "Küçük bir güncelleme yayımladım (0.0.2) — [X cihazında şu sorunu] düzelttim.
> Güncelleme geldiyse çek, olmadıysa uygulamayı hâlâ kurulu tutman yeterli. Teşekkürler!"

Build-in-public sesi bunu spam değil, gerçek iletişim gibi gösterir. Bir
Xiaomi veya Samsung özelinde bir fix olması nudge'ı daha güçlü yapar.

### 1c. Kanal Önceliği (Hıza Göre)

1. **r/AndroidAppTesters** + test-exchange Discord'ları — bu iş için yapılmış, en hızlı dönüşüm
2. **r/fossandroid** — en iyi uzun vadeli fit, topluluk yavaş ısınır
3. **r/SideProject** — etkileşim kolay, tester dönüşümü düşük
4. **X / Threads direkt ağ** — kalite > miktar, zor 5–7 spot için

### 1d. Recruitment Metni

**Türkçe (X / Threads):**
> Gizlilik-öncelikli, **çevrimdışı** bir PDF aracı geliştirdim: Quire.
> Kitapçık, birleştir, filigran, tarama, dahili okuyucu — hepsi cihazında,
> hiçbir dosya sunucuya gitmeden.
>
> Google Play kapalı testi için **test kullanıcısı arıyorum.**
> Karşılıklı test takasına da varım — sizinkini de denerim.
>
> Katılmak isteyen DM atsın, Google hesabı e-postasını alıp listeye ekleyeyim.
> Tek istediğim: uygulamayı **2 hafta kaldırma.** Hepsi bu.

**İngilizce (uluslararası takas):**
> Built a privacy-first, **fully offline** PDF toolkit: Quire.
> Booklet, merge, watermark, scan-to-PDF, built-in reader — all on-device,
> no file ever leaves your phone.
>
> Looking for **testers** for Google Play closed testing.
> Happy to do a mutual test exchange — I'll test yours too.
>
> DM me your Google account email. All I ask: keep the app installed for
> **2 weeks.** That's it.

**Ölçeklendirme notu:** DM + manuel liste 20 kişide yönetilemez hale gelir.
Bir Google Grup veya basit kayıt formu kur, linki oraya yönlendir.

---

## 2. Public Launch — Hero Thread (Türkçe, 6 Parça)

Hepsi 280 karakter altı. `[adın]` → GitHub kullanıcı adın.

**1/6 — Kanca**
> Bir PDF'i online bir dönüştürücüye yüklediğin an, o belge artık tam olarak
> senin değil. İmzan, kişisel bilgilerin… hepsi bir yabancının sunucusunda.
>
> Bu beni rahatsız etti. Ben de kendi aracımı yapmaya karar verdim. 🧵👇

**2/6 — Problem**
> Alternatifler ortadaydı: ya gigabaytlarca yer kaplayan dev masaüstü programları,
> ya da reklamdan geçilmeyen, belgelerini sunucularına yükleyen online araçlar.
>
> Hızlı, basit ve gizliliğe saygılı bir şey yoktu. 2/

**3/6 — Doğuş**
> Önce yapay zekâ yardımıyla, masaüstünde çalışan Python tabanlı bir araç yaptık.
> Terminal komutlarıyla başladı.
>
> Sonra sürükle-bırak yapabildiğim bir web arayüzü ekledik. Dönüştürdüğüm
> sayfaları indirmeden önizleyebiliyordum bile. 3/

**4/6 — Dönüm Noktası**
> Tam istediğimi elde etmiştim. Peki bunu nasıl yayımlayacaktım?
>
> Online dönüştürücülerden kaçıp, sonunda yine bir online dönüştürücü mü sunacaktım?
>
> Hayır. O yüzden masaüstü sürümünü açık kaynak yaptım. 4/

**5/6 — Mobile Geçiş**
> Sonra fark ettim: asıl ihtiyaç cep telefonundaydı. Mobildeki seçenekler ya
> reklam doluydu ya da hantaldı.
>
> Önce küçük bir MVP çıkardık. Ama iş tek araçta kalmadı; bütün PDF ihtiyaçlarını
> tek çatıda toplayan bir merkeze dönüştü. 5/

**6/6 — Bugün + İndirme**
> Karşınızda Quire: çevrimdışı, reklamsız, hepsi bir arada PDF aracı.
>
> Kitapçık, birleştir, filigran, tarama, okuyucu — hepsi cihazında, dosyaların
> sunucuya gitmeden. Sıfır ağ çağrısı.
>
> 📱 Play Store: [link]
> 🔗 Açık kaynak: github.com/[adın] 6/6

> **Test aşamasındaysan** 6/6'yı şununla değiştir:
> "📱 Dahili testteyiz! Denemek isterseniz DM atın.
> 🔗 Açık kaynak: github.com/[adın]"

---

## 3. Public Launch — Hero Thread (İngilizce, 6 Parça)

**1/6**
> The moment you upload a PDF to an online converter, that document isn't fully
> yours anymore. Your signature, your personal info… all on a stranger's server.
>
> That bothered me. So I built my own tool. 🧵👇

**2/6**
> The options were grim: giant desktop apps eating gigabytes, or online tools
> drowning in ads that upload your documents to their servers.
>
> Nothing was fast, simple AND respectful of your privacy. 2/

**3/6**
> First we built a Python desktop tool that runs entirely locally.
> Started with terminal commands.
>
> Then we added a drag-and-drop web UI. I could preview converted pages before
> downloading. 3/

**4/6**
> I had exactly what I wanted. But how would I ship it?
>
> Was I going to escape online converters… only to release yet another online
> converter?
>
> No. So I made the desktop version open source. 4/

**5/6**
> Then I realized the real need was on the phone. Mobile options were either
> ad-ridden or clunky.
>
> We started with a small MVP. It didn't stop there — it grew into a hub for
> every PDF need. 5/

**6/6**
> Meet Quire: offline, ad-free, all-in-one PDF toolkit.
>
> Booklet, merge, watermark, scan-to-PDF, reader — all on your device.
> Zero network calls. No internet permission required.
>
> 📱 Play Store: [link]
> 🔗 Open source: github.com/[yourname] 6/6

---

## 4. Branding — Buzzword'ü Somut Claim'e Çevir

"Gizlilik öncelikli" sloganı 2026'da artık buzzword. Rakiplerin kopyalayamayacağı
**spesifik ve teknik** iddialar kullan:

| Söyleme | Bunun yerine |
|---|---|
| "Gizlilik öncelikli" | "Sıfır ağ çağrısı" |
| "Verileriniz güvende" | "İnternet izni yok — manifest'te görebilirsin" |
| "Çevrimdışı çalışır" | "Cihazının CPU'sunda çalışır, hiçbir şey cihazdan çıkmaz" |

Açık kaynak bu iddiaları **doğrulanabilir** kılar — rakiplerin gizlilik
politikasından 10x güçlü bir güven sinyali.

---

## 5. Görsel / Video (Etkileşimin %80'i)

Hero thread'in 1/6 veya 3/6'sına 10–15 sn ekran kaydı / GIF ekle.

En "satisfying" anlar:
- **Perspektif düzeltme:** Yamuk çekilmiş bir belgenin köşeleri seçilip düzleşiyor.
- **Kitapçık katlama:** PDF booklet düzenine dönüşüyor.

---

## 6. Topluluk Hedefleri

| Topluluk | Uygunluk | Not |
|---|---|---|
| r/fossandroid | En iyi | Açık kaynak + Android = birebir |
| r/androidapps | İyi | Genel uygulama tanıtımı |
| r/privacy, r/degoogle | İyi | Gizlilik açısı için güçlü |
| r/SideProject | İyi | Build-in-public kültürü |
| r/AndroidAppTesters | Test takası | Closed test için en hızlı |
| Test-exchange Discord'ları | Test takası | 20 tester / 14 gün için en doğrudan |
| r/selfhosted | Yanlış | Self-hosted ≠ sunucusuz mobil uygulama |

Paylaşmadan önce her sub'ın aktif ve self-promotion kuralının uygun olduğunu teyit et.

---

## 7. Dağıtım Yol Haritası

| Kanal | Zaman | Not |
|---|---|---|
| Google Play Dahili Test | Şu an | Aktif |
| Google Play Kapalı Test | 20t/14g eşiği sonrası | Otomatik geçiş |
| Google Play Public | v1.0 | Hero thread ile eş zamanlı |
| GitHub (açık kaynak) | Public launch ile birlikte | Güvenlik kontrolü önce |
| F-Droid | v1.0 sonrası | Capacitor reproducible-build süreci gerekli; r/fossandroid'in en büyük güven sinyali |

**F-Droid zamanlama notu:** v1.0 public launch'tan önce başvur, ama eş zamanlı
dağıtım hedefle. r/fossandroid kitlesi F-Droid'de olmayan bir uygulamayı
"gerçek FOSS" saymaz.

---

## 8. Geri Bildirim Döngüsü

- **Çökme / hata:** Play Console Android Vitals yeterli — ayrı form gerekmez.
- **Nitel yorum (opsiyonel):** 3 soruluk form (cihaz modeli, hata, genel izlenim).
  - Not: "Veri sunucuya gitmiyor" diyen bir ürün için Google Form ironi.
    Formu opsiyonel tut ve küçük bir not ekle.

---

## 9. Build-in-Public Günlükleri

İlk thread'den sonra süreci sürdür — **takvime göre değil, gerçek gelişme oldukça.**

Örnek tonlar:
- "8 test kullanıcısına ulaştık, destek olan herkese teşekkürler."
- "Bir tester Xiaomi'de kameranın açılmadığını bildirdi; düzeltip 0.0.2 gönderildi."

Kural: **Tutarlılık > sıklık.** Zorunlu günlük spam'e döner.

---

## 10. Lansman Kontrol Listesi

**Şimdi (test aşaması)**
- [ ] Retention buffer: 30–35 davet hedefle, 20 aktif yakala
- [ ] Takip tablosu oluştur (ad / e-posta / davet / yükleme / 14. gün)
- [ ] Google Grup veya kayıt formu kur (manuel DM'den kurtul)
- [ ] Recruitment metnini (1c) test takası topluluklarında paylaş
- [ ] 7. günde nudge mesajı gönder
- [ ] Masaüstü repoyu açık kaynak yap (güvenlik kontrolünden sonra)

**Public launch öncesi**
- [ ] Görsel / GIF hazırla (perspektif düzeltme veya booklet)
- [ ] Hero thread'e GitHub adını + Play Store linkini yerleştir (TR ve EN)
- [ ] 6/6'yı "indirme" versiyonuna çevir
- [ ] F-Droid başvurusunu hazırla (reproducible build adımları)

**Açık kaynak güvenlik kontrolü (kritik)**
- [ ] Repoda keystore (`*.jks`) yok
- [ ] `local.properties` / şifreler yok
- [ ] Gerçek imza, kişisel veri, özel anahtar yok
- [ ] `.gitignore` doğru ayarlı (mobil projede zaten doğru)
