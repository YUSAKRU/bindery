# Bundled fonts

Two weights of the same subset. `NotoSans-Latin.ttf` is used by the watermark tool
(`src/engine/watermark-engine.ts`); the printed booklet instructions sheet
(`src/engine/instructions-page.ts`), the cover studio (`src/engine/cover-engine.ts`) and
the markdown booklet renderer (`src/engine/markdown-render.ts`) use both, since their
headings are bold.

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

### Coverage (read back from the built subset's `cmap`, 2026-09-10)

| Range | In these faces |
|---|---|
| Latin-1 Supplement U+00A0–00FF | all 96 |
| Latin Extended-A U+0100–017F | all 128 |
| Latin Extended-B U+0180–024F | all 208 |
| General punctuation U+2000–206F | 111 of 112 (only U+2065, an unassigned invisible, is absent) |
| Currency U+20A0–20BF | all 32 |
| Trademark U+2122 | yes |
| **Arrows U+2190–2193** | **none** |
| **Geometric shapes U+25A0–25CF** | **1 of 48** (only U+25CC) |

So: full Turkish (`ı ş ğ İ Ş Ğ ç ö ü â î û`), Western European (`á é í ó ú à è ñ ä ö ü ß å ø
æ`), Eastern European (`ą ć ę ł ń ś ź ż č ď ě ř š ů ž`), `— – … « » “ ” ‘ ’`, `€ ₺`, `™` — but
**no `← ↑ → ↓`, and none of `■ ▲ ► ▼ ● ◆`**.

> **The last two rows used to read "arrows U+2190–2193, geometric shapes U+25A0–25CF" under a
> heading that said "verified, not assumed".** They were neither. The `--unicodes` list below
> asks for those ranges, but `pyftsubset` keeps only what the source face actually has, and
> `NotoSans-Regular.ttf` has none of the arrows and only U+25CC of the geometric block — the
> full system face was parsed to confirm this is the source, not the subsetting. The list had
> been copied from the request, not read back from the result. **When you widen the ranges,
> re-read the built file's `cmap`; do not trust the command line.**

`NotoSansMono-Regular.ttf` (below) *does* carry all four arrows and all 48 geometric shapes,
because Noto Sans Mono ships them. That is why box-drawing diagrams survive in code blocks
while the same characters in body text do not.

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

## `NotoSansMono-Regular.ttf`

A subset of **Noto Sans Mono Regular**, bundled so code blocks and ASCII/Unicode box diagrams
can render cleanly in markdown booklets.

| | |
|---|---|
| Source | `/usr/share/fonts/noto/NotoSansMono-Regular.ttf` |
| Subset size | **58 KB** |
| Glyphs | 884 |
| License | SIL Open Font License 1.1 |

### Coverage
- Latin-1 + Latin Extended-A/B (Turkish + Western/Eastern Europe)
- Punctuation, currency, misc symbols
- **Box Drawing** (`U+2500–257F`) and **Block Elements** (`U+2580–259F`) for architecture flow diagrams

### Regenerating
```bash
uv run --with fonttools pyftsubset /usr/share/fonts/noto/NotoSansMono-Regular.ttf \
  --output-file=src/assets/fonts/NotoSansMono-Regular.ttf \
  --unicodes="U+0000-00FF,U+0100-017F,U+0180-024F,U+2000-206F,U+20A0-20BF,U+2122,U+2190-2193,U+2500-257F,U+2580-259F,U+25A0-25CF" \
  --layout-features="" --no-hinting --desubroutinize
```
