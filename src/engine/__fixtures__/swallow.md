# Yutma testi

Bu belge, Markdown hattından geçerken sessizce kaybolan içeriği yakalamak için var.
Her satırı bir kez gerçek bir belgede ısırdı. Değiştirmeden önce
`markdown-swallow.test.ts` içindeki beklenen çıktıyı da güncelle.
Dosya bilerek bir BOM ile başlıyor: o da basılabilen bir karakter değil ve
düşürülmezse ilk başlığın önünde görünürdü.

## Yumuşak satır sonu ve sekme

Bu paragraf ikinci satıra
sarıyor ve arada bir	sekme var.

- 01_PRD_AND_VISION.md
  Devam satırı, madde iminin altında.

## Görev listesi

- [x] biten iş
- [ ] bekleyen iş

## Üstü çizili

Eski karar ~~tüm belgede ters çevir~~ yerine imza içinde çevriliyor.

## Etiket şeklinde olan ve olmayan

Tampon Vec<u8> ve Arc<Mutex<T>> ile tutulur, yol kurgu_<USERNAME> olur.
Su H<sub>2</sub>O olur, Satır<br>sonu da böyle.

<div class="uyari">Blok içindeki metin korunur.</div>

## Görsel

Şema: ![Mimari şeması](diagram.png) burada anlatılıyor.

## Para ve kabuk değişkeni

Tutar $50 ve $100 arası. Yol $HOME ve $PATH ayarlı.

## Satır içi formül

Hattı $\rightarrow$ DMA-BUF, gecikme $\mathbf{0\ \mu s}$, başlangıç $\le \mathbf{500\ ms}$.
Örnekleme $R=96{,}000$ Hz, tanjant $\tanh$, aralık $\pm\infty$, süre $\frac{S + 1}{R}$.
Gerçek notasyon $E = mc^2$ korunur.

## Display formül

$$\text{snap}(\text{snap}(T, \text{FPS}), \text{FPS}) \equiv \text{snap}(T, \text{FPS})$$

Yan yana: $$\text{a_b}(S) = \frac{S}{R}$$ $$\text{c_d}(U) = U \times 2$$

$$\sum_{i=0}^{n} x_i$$

## Kod

`x → y` satır içi kod.

```rust
    fn prop_frame_snapping_idempotent(us in 0u64..360_000_000_000u64, fps in arb_frame_rate()) {
        let t1 = Timecode { us }.snap_to_frame(fps);
    }
```

```
[VPU Decoder] ──────────────────────────────────────────► [VRAM Surface]
```

## Tablo

| Alan | Değer |
|---|---:|
| Sırt | 12,4 mm |
| Yaprak | 46 |
