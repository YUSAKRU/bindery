import { Capacitor } from '@capacitor/core';
import { STORE_URL, openStoreListing } from './review-hook';
import { t } from '../i18n';

export const PREF_ANDROID_REDIRECTED = 'bindery.android_play_redirected';
export const PREF_PWA_BANNER_DISMISSED = 'bindery.pwa_banner_dismissed';

export type WebOS = 'android' | 'ios' | 'other';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function detectWebOS(userAgent?: string, maxTouchPoints?: number): WebOS {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const touches = maxTouchPoints ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0);

  if (/android/i.test(ua)) {
    return 'android';
  }
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touches > 1)) {
    return 'ios';
  }
  return 'other';
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;

  if (window.matchMedia?.('(display-mode: standalone)')?.matches === true) {
    return true;
  }
  if (typeof navigator !== 'undefined' && (navigator as unknown as { standalone?: boolean }).standalone === true) {
    return true;
  }
  if (typeof window.location?.search === 'string' && window.location.search.includes('source=pwa')) {
    return true;
  }
  return false;
}

export function handleAndroidFirstVisitRedirect(
  navigate: (url: string) => void = (url) => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = url;
    }
  }
): boolean {
  if (Capacitor.getPlatform() !== 'web') return false;
  if (isStandalonePwa()) return false;
  if (detectWebOS() !== 'android') return false;

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(PREF_ANDROID_REDIRECTED) === 'true') {
      return false;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREF_ANDROID_REDIRECTED, 'true');
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }

  navigate(STORE_URL);
  return true;
}

export function initPwaInstallExperience(options?: {
  showToast?: (msg: string) => void;
  navigate?: (url: string) => void;
}): void {
  if (Capacitor.getPlatform() !== 'web') return;

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof navigator.serviceWorker?.register === 'function') {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  handleAndroidFirstVisitRedirect(options?.navigate);

  if (isStandalonePwa()) return;

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(PREF_PWA_BANNER_DISMISSED) === 'true') {
      return;
    }
  } catch {
    // Ignore storage errors
  }

  if (typeof document === 'undefined') return;

  const pwaBanner = document.getElementById('pwaInstallBanner');
  const pwaInstallBtn = document.getElementById('pwaInstallBtn');
  const pwaPlayStoreBtn = document.getElementById('pwaPlayStoreBtn');
  const pwaCloseBtn = document.getElementById('pwaBannerCloseBtn');
  const iosBanner = document.getElementById('iosInstallBanner');
  const iosCloseBtn = document.getElementById('iosBannerCloseBtn');

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      let dismissed = false;
      try {
        dismissed = typeof localStorage !== 'undefined' && localStorage.getItem(PREF_PWA_BANNER_DISMISSED) === 'true';
      } catch {}
      if (pwaBanner && !dismissed) {
        pwaBanner.hidden = false;
      }
    });
  }

  const os = detectWebOS();
  if (os === 'android' && pwaBanner) {
    pwaBanner.hidden = false;
  }
  if (os === 'ios' && iosBanner) {
    iosBanner.hidden = false;
  }

  pwaPlayStoreBtn?.addEventListener('click', () => {
    void openStoreListing();
  });

  pwaInstallBtn?.addEventListener('click', () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      void promptEvent
        .prompt()
        .then(() => promptEvent.userChoice)
        .then((choice) => {
          if (choice?.outcome === 'accepted' && pwaBanner) {
            pwaBanner.hidden = true;
          }
        })
        .catch(() => {});
    } else {
      options?.showToast?.(t('pwa.androidManualHint'));
    }
  });

  pwaCloseBtn?.addEventListener('click', () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PREF_PWA_BANNER_DISMISSED, 'true');
      }
    } catch {}
    if (pwaBanner) pwaBanner.hidden = true;
  });

  iosCloseBtn?.addEventListener('click', () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PREF_PWA_BANNER_DISMISSED, 'true');
      }
    } catch {}
    if (iosBanner) iosBanner.hidden = true;
  });
}
