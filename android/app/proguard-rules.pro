# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Bindery ─────────────────────────────────────────────────────────────────
# R8 açıldı (minifyEnabled true). Play Console "Kod karartma %2" uyarısı için;
# eşik %25, son tarih Şubat 2027.
#
# Yığın izlerini okunabilir tut. Uygulama kendi hata kaydını cihazda tutuyor
# (BinderyCrashListener + src/native/error-log.ts) ve o kayıt karartılmış
# sınıf adlarıyla dolarsa teşhis için işe yaramaz hale gelir. Kaynak dosya adı
# yine gizleniyor, satır numarası korunuyor.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor eklenti koruma kuralları ayrıca eklenmiyor: @capacitor/android
# bunları consumerProguardFiles ile kendisi dağıtıyor (capacitor/build.gradle:50)
# — @CapacitorPlugin işaretli sınıflar, Plugin'den türeyen her şey ve
# @PluginMethod metotları oradan korunuyor. Kendi eklentilerimiz
# (OpenDocumentPlugin, PrintPlugin) o kuralların kapsamında.
