# Bundled fonts

Two weights of the same subset. `NotoSans-Latin.ttf` is used by the watermark tool
(`src/engine/watermark-engine.ts`); the printed booklet instructions sheet
(`src/engine/instructions-page.ts`) uses both, since its headings are bold.

Both are produced by the same `pyftsubset` command below — only the source face differs
(`NotoSans-Regular.ttf` / `NotoSans-Bold.ttf`). Keep them in sync: if you widen the unicode
ranges for one, do the other too, or bold headings will silently lose glyphs the body text has.

## `NotoSans-Latin.ttf` and `NotoSans-Latin-Bold.ttf`

A subset of **Noto Sans Regular**, bundled so pdf-lib can draw text the WinAnsi-encoded
`StandardFonts` cannot. See finding **C1** in `docs/CODE-REVIEW-2026-08-03.md`: pdf-lib's
built-in Helvetica throws `WinAnsi cannot encode "ş"` on Turkish characters, which crashed
the watermark tool for any Turkish user who typed Turkish into it.

| | |
|---|---|
| Source | `/usr/share/fonts/noto/NotoSans-Regular.ttf` (Noto Sans Regular, 608 KB) |
| Subset size | **48 KB** each (96 KB total) |
| Glyphs | 674 each |
| License | SIL Open Font License 1.1 — redistribution in an application is permitted |

### Coverage (verified, not assumed)

- **Latin-1 + Latin Extended-A/B** — full Turkish (`ı ş ğ İ Ş Ğ ç ö ü â î û`), Western
  European (`á é í ó ú à è ñ ä ö ü ß å ø æ`) and Eastern European (`ą ć ę ł ń ś ź ż č ď ě
  ř š ů ž`)
- **General punctuation** — `— – … « » “ ” ‘ ’`
- **Currency** — `€ ₺` and the rest of U+20A0–20BF
- **Misc** — `™`, arrows U+2190–2193, geometric shapes U+25A0–25CF

Scripts **not** covered: Greek, Cyrillic, Arabic, Hebrew, CJK. Text in those scripts will
still fail to encode. If that becomes a requirement, regenerate with wider `--unicodes`
ranges and accept the size increase — do not silently swap in a different font family.

### Regenerating

Requires `fonttools` (`pip install fonttools brotli`):

```bash
pyftsubset /usr/share/fonts/noto/NotoSans-Regular.ttf \
  --output-file=src/assets/fonts/NotoSans-Latin.ttf \
  --unicodes="U+0000-00FF,U+0100-017F,U+0180-024F,U+2000-206F,U+20A0-20BF,U+2122,U+2190-2193,U+25A0-25CF" \
  --layout-features="" --no-hinting --desubroutinize
```

After regenerating, re-run the coverage check before committing — a subset that silently
drops `ı`/`ş`/`ğ` reintroduces C1 without failing any build.
