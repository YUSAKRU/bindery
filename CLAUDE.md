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
export JAVA_HOME=/opt/android-studio/jbr && \
export ANDROID_HOME=$HOME/Android/Sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

### Step by Step

#### 1. Run Tests
```bash
npm run test
```
- 121 tests will run
- All of them must pass

#### 2. Build
```bash
npm run build
```
- Output: `dist/` folder
- TypeScript check + Vite build

#### 3. Deploy to Device
```bash
export JAVA_HOME=/opt/android-studio/jbr
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

npx cap sync          # Sync web assets
npx cap run android   # Build + Deploy
```

### Setup Info

- **Android SDK**: `$HOME/Android/Sdk`
- **Java Runtime**: `/opt/android-studio/jbr`
- **Connected Device ID**: check with `adb devices` (device-specific, varies by environment)
- **App ID**: `com.eduplayconnect.bindery`
- **App Name**: Bindery

### Fish Shell Alias (Optional)

Add to `~/.config/fish/config.fish`:

```fish
function android-deploy
    npm run test && npm run build && \
    set -x JAVA_HOME /opt/android-studio/jbr && \
    set -x ANDROID_HOME $HOME/Android/Sdk && \
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

---

<a name="-türkçe"></a>
## Türkçe

### Quick Start: Test, Build & Deploy to Android Device

Tüm işlemleri tek komutla yapabilirsin:

```bash
npm run test && npm run build && \
export JAVA_HOME=/opt/android-studio/jbr && \
export ANDROID_HOME=$HOME/Android/Sdk && \
export PATH=$PATH:$ANDROID_HOME/platform-tools && \
npx cap sync && npx cap run android
```

### Adım Adım

#### 1. Test Çalıştır
```bash
npm run test
```
- 121 test çalışacak
- Tümü geçmesi gerekli

#### 2. Build Oluştur
```bash
npm run build
```
- Output: `dist/` klasörü
- TypeScript kontrolü + Vite build

#### 3. Cihaza Deploy Et
```bash
export JAVA_HOME=/opt/android-studio/jbr
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

npx cap sync          # Web assets'i senkronize et
npx cap run android   # Build + Deploy
```

### Kurulum Bilgisi

- **Android SDK**: `$HOME/Android/Sdk`
- **Java Runtime**: `/opt/android-studio/jbr`
- **Bağlı Cihaz ID**: `adb devices` ile kontrol edin (cihaza özel, ortama göre değişir)
- **App ID**: `com.eduplayconnect.bindery`
- **App Name**: Bindery

### Fish Shell için Alias (Opsiyonel)

`~/.config/fish/config.fish` içine ekle:

```fish
function android-deploy
    npm run test && npm run build && \
    set -x JAVA_HOME /opt/android-studio/jbr && \
    set -x ANDROID_HOME $HOME/Android/Sdk && \
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
