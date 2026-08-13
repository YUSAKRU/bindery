# PDF Booklet Mobile - Build & Deployment Guide

**Language / Dil:**
- [English](#-english)
- [Türkçe](#-türkçe)

---

<a name="-english"></a>
## English

### Quick Start: Test, Build & Deploy to Android Device

You can do everything with a single command:

```bash
npm run test && npm run build && \
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk && \
export ANDROID_HOME=/opt/android-sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

### Step by Step

#### 1. Run Tests
```bash
npm run test
```
- 287 tests will run
- All of them must pass

#### 2. Build
```bash
npm run build
```
- Output: `dist/` folder
- TypeScript check + Vite build

#### 3. Deploy to Device
```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

npx cap sync          # Sync web assets
npx cap run android   # Build + Deploy
```

### Setup Info

- **Android SDK**: `/opt/android-sdk`
- **Java Runtime**: `/usr/lib/jvm/java-21-openjdk`
- **Connected Device ID**: check with `adb devices` (device-specific, varies by environment)
- **App ID**: `com.eduplayconnect.bindery`
- **App Name**: Bindery

### Fish Shell Alias (Optional)

Add to `~/.config/fish/config.fish`:

```fish
function android-deploy
    npm run test && npm run build && \
    set -x JAVA_HOME /usr/lib/jvm/java-21-openjdk && \
    set -x ANDROID_HOME /opt/android-sdk && \
    set -x PATH $PATH $ANDROID_HOME/platform-tools && \
    npx cap sync && npx cap run android
end
```

Then just run:
```bash
android-deploy
```

### Notes

- Build warning: chunk size over 500kB (pdfjs-dist is large) — normal for now
- Gradle build: ~1-2 seconds
- APK deploy: ~4-5 seconds
- The app will launch automatically on the device

### Codebase Memory (MCP)

`codebase-memory-mcp` is installed globally (`~/.claude/.mcp.json`, `~/.claude.json`) — available in every Claude Code session, not just this project. General tool usage guide lives in `~/.claude/skills/codebase-memory/SKILL.md`. If the `mcp__codebase-memory-mcp__*` tools show as deferred, load them with `ToolSearch("select:mcp__codebase-memory-mcp__search_graph,...")` first.

- This project's indexed name: `home-ruveys-Desktop-projects-bindery`
- Architecture (from `get_architecture`): `ui` is the entry layer (outbound calls only); `engine`, `native`, `i18n` are core layers (high fan-in, zero fan-out)
- Hotspots to be careful editing: `validatePdf` (13+ direct callers — merge/booklet/rotate/watermark/page-numbers/reader all depend on it), `makeBooklet` (calls into 15 functions directly), `t` (i18n, fan-in 38)
- The booklet-engine cluster (`makeBooklet`, `resolveSheetSize`, `computeSignatureMappings`, ...) has the highest cohesion (0.82) in the codebase — treat it as one tightly-coupled unit when refactoring
- Before editing a shared function, run `trace_path(function_name=..., direction="both", risk_labels=true)` to see blast radius; run `detect_changes` after editing to map the diff to affected symbols
- **Dead-code false positives**: `search_graph(max_degree=0)` flags functions with no `CALLS` edges, but event-listener callbacks (`addEventListener(..., handler)`), object/config property references (e.g. `{ manualChunks }`), and mock object methods never create `CALLS` edges either. Always cross-check with grep before deleting anything it flags.

---

<a name="-türkçe"></a>
## Türkçe

### Quick Start: Test, Build & Deploy to Android Device

Tüm işlemleri tek komutla yapabilirsin:

```bash
npm run test && npm run build && \
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk && \
export ANDROID_HOME=/opt/android-sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

### Adım Adım

#### 1. Test Çalıştır
```bash
npm run test
```
- 287 test çalışacak
- Tümü geçmesi gerekli

#### 2. Build Oluştur
```bash
npm run build
```
- Output: `dist/` klasörü
- TypeScript kontrolü + Vite build

#### 3. Cihaza Deploy Et
```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

npx cap sync          # Web assets'i senkronize et
npx cap run android   # Build + Deploy
```

### Kurulum Bilgisi

- **Android SDK**: `/opt/android-sdk`
- **Java Runtime**: `/usr/lib/jvm/java-21-openjdk`
- **Bağlı Cihaz ID**: `adb devices` ile kontrol edin (cihaza özel, ortama göre değişir)
- **App ID**: `com.eduplayconnect.bindery`
- **App Name**: Bindery

### Fish Shell için Alias (Opsiyonel)

`~/.config/fish/config.fish` içine ekle:

```fish
function android-deploy
    npm run test && npm run build && \
    set -x JAVA_HOME /usr/lib/jvm/java-21-openjdk && \
    set -x ANDROID_HOME /opt/android-sdk && \
    set -x PATH $PATH $ANDROID_HOME/platform-tools && \
    npx cap sync && npx cap run android
end
```

Sonra sadece çalıştır:
```bash
android-deploy
```

### Notlar

- Build uyarısı: Chunk size 500kB üzerinde (pdfjs-dist büyük) - şimdilik normal
- Gradle build: ~1-2 saniye
- APK deploy: ~4-5 saniye
- App otomatik olarak cihazda başlayacak

### Kod Hafızası (MCP)

`codebase-memory-mcp` global olarak kurulu (`~/.claude/.mcp.json`, `~/.claude.json`) — sadece bu projede değil, tüm Claude Code oturumlarında mevcut. Genel kullanım rehberi `~/.claude/skills/codebase-memory/SKILL.md` içinde global olarak yazılı. `mcp__codebase-memory-mcp__*` araçları deferred görünüyorsa önce `ToolSearch("select:mcp__codebase-memory-mcp__search_graph,...")` ile yükle.

- Bu projenin grafikte indexli adı: `home-ruveys-Desktop-projects-bindery`
- Mimari (`get_architecture`'dan): `ui` sadece dışa çağrı yapan giriş katmanı; `engine`, `native`, `i18n` yüksek fan-in / sıfır fan-out'lu çekirdek katmanlar
- Dikkatli düzenlenmesi gereken hotspot'lar: `validatePdf` (13+ doğrudan çağıran — merge/booklet/rotate/watermark/page-numbers/reader hepsi buna bağlı), `makeBooklet` (doğrudan 15 fonksiyonu çağırıyor), `t` (i18n, fan-in 38)
- Booklet-engine cluster'ı (`makeBooklet`, `resolveSheetSize`, `computeSignatureMappings`, ...) kod tabanındaki en yüksek uyuma (0.82) sahip — refactor yaparken tek bir sıkı bağlı birim olarak ele al
- Paylaşılan bir fonksiyonu düzenlemeden önce `trace_path(function_name=..., direction="both", risk_labels=true)` ile etki alanını gör; düzenledikten sonra `detect_changes` ile diff'in hangi sembolleri etkilediğini kontrol et
- **Dead-code yanlış pozitifleri**: `search_graph(max_degree=0)` hiç `CALLS` edge'i olmayan fonksiyonları işaretliyor, ama event-listener callback'leri (`addEventListener(..., handler)`), obje/config property referansları (örn. `{ manualChunks }`) ve mock obje metotları da `CALLS` edge'i oluşturmuyor. İşaretlenen hiçbir şeyi grep ile çapraz doğrulamadan silme.
