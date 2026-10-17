import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = vi.hoisted(() => ({ platform: 'web' }));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      getPlatform: () => platformState.platform,
      isNativePlatform: () => platformState.platform !== 'web',
    },
  };
});

vi.mock('./review-hook', async () => {
  const actual = await vi.importActual<typeof import('./review-hook')>('./review-hook');
  return {
    ...actual,
    openStoreListing: vi.fn(),
  };
});

class MockElement {
  id: string;
  hidden: boolean;
  private listeners = new Map<string, Array<() => void>>();

  constructor(id: string, hidden = true) {
    this.id = id;
    this.hidden = hidden;
  }

  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(fn);
  }

  click() {
    const list = this.listeners.get('click') ?? [];
    for (const fn of list) {
      fn();
    }
  }
}

const elements = new Map<string, MockElement>();
const mockDocument = {
  getElementById: (id: string) => elements.get(id) ?? null,
};

const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, String(val)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

const windowListeners = new Map<string, Array<(e: any) => void>>();
let matchMediaStandalone = false;
const mockWindow = {
  location: { search: '', href: '' },
  matchMedia: (query: string) => ({
    matches: query === '(display-mode: standalone)' ? matchMediaStandalone : false,
  }),
  addEventListener: (type: string, fn: (e: any) => void) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type)!.push(fn);
  },
  removeEventListener: (type: string, fn: (e: any) => void) => {
    const list = windowListeners.get(type) ?? [];
    windowListeners.set(type, list.filter((l) => l !== fn));
  },
  dispatchEvent: (event: any) => {
    const list = windowListeners.get(event.type) ?? [];
    for (const fn of list) {
      fn(event);
    }
    return true;
  },
};

let mockUa = '';
let mockTouches = 0;
let mockStandalone: boolean | undefined = undefined;
let mockServiceWorker: { register: any } | undefined = undefined;

const mockNavigator = {
  get userAgent() {
    return mockUa;
  },
  get maxTouchPoints() {
    return mockTouches;
  },
  get standalone() {
    return mockStandalone;
  },
  get serviceWorker() {
    return mockServiceWorker;
  },
};

vi.stubGlobal('document', mockDocument);
vi.stubGlobal('localStorage', mockLocalStorage);
vi.stubGlobal('window', mockWindow);
vi.stubGlobal('navigator', mockNavigator);

import {
  detectWebOS,
  isStandalonePwa,
  handleAndroidFirstVisitRedirect,
  initPwaInstallExperience,
  PREF_ANDROID_REDIRECTED,
  PREF_PWA_BANNER_DISMISSED,
} from './pwa-install';
import { STORE_URL, openStoreListing } from './review-hook';
import { t } from '../i18n';

describe('PWA Install & Platform Detection', () => {
  beforeEach(() => {
    platformState.platform = 'web';
    storage.clear();
    elements.clear();
    windowListeners.clear();
    mockWindow.location.search = '';
    mockWindow.location.href = '';
    matchMediaStandalone = false;
    mockUa = '';
    mockTouches = 0;
    mockStandalone = undefined;
    mockServiceWorker = undefined;
    vi.clearAllMocks();

    // Set up standard banner DOM elements
    elements.set('pwaInstallBanner', new MockElement('pwaInstallBanner', true));
    elements.set('pwaInstallBtn', new MockElement('pwaInstallBtn', false));
    elements.set('pwaPlayStoreBtn', new MockElement('pwaPlayStoreBtn', false));
    elements.set('pwaBannerCloseBtn', new MockElement('pwaBannerCloseBtn', false));
    elements.set('iosInstallBanner', new MockElement('iosInstallBanner', true));
    elements.set('iosBannerCloseBtn', new MockElement('iosBannerCloseBtn', false));
  });

  describe('detectWebOS', () => {
    it('accurately classifies Android user agents', () => {
      const androidUa =
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      expect(detectWebOS(androidUa)).toBe('android');

      mockUa = androidUa;
      expect(detectWebOS()).toBe('android');
    });

    it('accurately classifies iPhone and iPad user agents', () => {
      const iphoneUa =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      const ipadUa =
        'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
      const ipodUa =
        'Mozilla/5.0 (iPod touch; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15';

      expect(detectWebOS(iphoneUa)).toBe('ios');
      expect(detectWebOS(ipadUa)).toBe('ios');
      expect(detectWebOS(ipodUa)).toBe('ios');
    });

    it('accurately classifies iPadOS desktop-mode (Macintosh UA with touch points > 1)', () => {
      const macintoshUa =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      expect(detectWebOS(macintoshUa, 5)).toBe('ios');
      expect(detectWebOS(macintoshUa, 0)).toBe('other');

      mockUa = macintoshUa;
      mockTouches = 5;
      expect(detectWebOS()).toBe('ios');
    });

    it('accurately classifies desktop and other user agents as other', () => {
      const windowsUa =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const linuxUa =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      expect(detectWebOS(windowsUa)).toBe('other');
      expect(detectWebOS(linuxUa)).toBe('other');
      expect(detectWebOS('')).toBe('other');
    });
  });

  describe('isStandalonePwa', () => {
    it('returns false for default browser display mode', () => {
      expect(isStandalonePwa()).toBe(false);
    });

    it('returns true when display-mode matches standalone', () => {
      matchMediaStandalone = true;
      expect(isStandalonePwa()).toBe(true);
    });

    it('returns true when navigator.standalone is true (iOS Safari)', () => {
      mockStandalone = true;
      expect(isStandalonePwa()).toBe(true);
    });

    it('returns true when URL search contains source=pwa', () => {
      mockWindow.location.search = '?source=pwa';
      expect(isStandalonePwa()).toBe(true);
    });
  });

  describe('handleAndroidFirstVisitRedirect', () => {
    const androidUa =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

    it('redirects to STORE_URL and sets preference on first Android web visit', () => {
      mockUa = androidUa;
      const navigateMock = vi.fn();

      const result = handleAndroidFirstVisitRedirect(navigateMock);

      expect(result).toBe(true);
      expect(navigateMock).toHaveBeenCalledWith(STORE_URL);
      expect(storage.get(PREF_ANDROID_REDIRECTED)).toBe('true');
    });

    it('returns false without redirecting on subsequent visits', () => {
      mockUa = androidUa;
      storage.set(PREF_ANDROID_REDIRECTED, 'true');
      const navigateMock = vi.fn();

      const result = handleAndroidFirstVisitRedirect(navigateMock);

      expect(result).toBe(false);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('returns false on iOS web', () => {
      mockUa =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
      const navigateMock = vi.fn();

      const result = handleAndroidFirstVisitRedirect(navigateMock);

      expect(result).toBe(false);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('returns false in standalone mode', () => {
      mockUa = androidUa;
      mockWindow.location.search = '?source=pwa';
      const navigateMock = vi.fn();

      const result = handleAndroidFirstVisitRedirect(navigateMock);

      expect(result).toBe(false);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('returns false on native Android platform', () => {
      platformState.platform = 'android';
      mockUa = androidUa;
      const navigateMock = vi.fn();

      const result = handleAndroidFirstVisitRedirect(navigateMock);

      expect(result).toBe(false);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe('initPwaInstallExperience', () => {
    const androidUa =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    const iosUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

    it('unhides #pwaInstallBanner on Android web and handles prompt and dismiss', async () => {
      mockUa = androidUa;
      const showToast = vi.fn();

      initPwaInstallExperience({ showToast });

      const pwaBanner = elements.get('pwaInstallBanner')!;
      const pwaInstallBtn = elements.get('pwaInstallBtn')!;
      const pwaPlayStoreBtn = elements.get('pwaPlayStoreBtn')!;
      const pwaCloseBtn = elements.get('pwaBannerCloseBtn')!;

      // Banner should be visible on Android
      expect(pwaBanner.hidden).toBe(false);

      // Clicking install without deferredPrompt triggers manual hint toast
      pwaInstallBtn.click();
      expect(showToast).toHaveBeenCalledWith(t('pwa.androidManualHint'));

      // Clicking Play Store button calls openStoreListing
      pwaPlayStoreBtn.click();
      expect(openStoreListing).toHaveBeenCalled();

      // Dispatch beforeinstallprompt
      const promptMock = vi.fn().mockResolvedValue(undefined);
      let choiceResolve!: (val: { outcome: 'accepted' | 'dismissed'; platform: string }) => void;
      const userChoicePromise = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>(
        (resolve) => {
          choiceResolve = resolve;
        }
      );

      const event = {
        type: 'beforeinstallprompt',
        preventDefault: vi.fn(),
        prompt: promptMock,
        userChoice: userChoicePromise,
      };
      mockWindow.dispatchEvent(event);

      // Now click install button - should trigger prompt()
      pwaInstallBtn.click();
      expect(promptMock).toHaveBeenCalled();

      // Resolve userChoice with accepted
      choiceResolve({ outcome: 'accepted', platform: 'web' });
      await userChoicePromise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pwaBanner.hidden).toBe(true);

      // Test close button
      pwaBanner.hidden = false;
      pwaCloseBtn.click();
      expect(pwaBanner.hidden).toBe(true);
      expect(storage.get(PREF_PWA_BANNER_DISMISSED)).toBe('true');
    });

    it('unhides #iosInstallBanner on iOS web and allows dismissing', () => {
      mockUa = iosUa;

      initPwaInstallExperience();

      const iosBanner = elements.get('iosInstallBanner')!;
      const iosCloseBtn = elements.get('iosBannerCloseBtn')!;
      const pwaBanner = elements.get('pwaInstallBanner')!;

      expect(iosBanner.hidden).toBe(false);
      expect(pwaBanner.hidden).toBe(true);

      iosCloseBtn.click();
      expect(iosBanner.hidden).toBe(true);
      expect(storage.get(PREF_PWA_BANNER_DISMISSED)).toBe('true');
    });

    it('does nothing when banner was previously dismissed', () => {
      mockUa = androidUa;
      storage.set(PREF_PWA_BANNER_DISMISSED, 'true');

      initPwaInstallExperience();

      const pwaBanner = elements.get('pwaInstallBanner')!;
      expect(pwaBanner.hidden).toBe(true);
    });

    it('registers service worker when available on web platform', () => {
      const registerMock = vi.fn().mockReturnValue(Promise.resolve());
      mockServiceWorker = { register: registerMock };

      initPwaInstallExperience();

      expect(registerMock).toHaveBeenCalledWith('./sw.js');
    });
  });
});
