import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as any).DOMMatrix = class DOMMatrix {};
  }
});

import { FileTooLargeError } from '../native/file-bridge';
import { setLanguage } from '../i18n';
import { errorText } from './app';

describe('errorText localization for FileTooLargeError', () => {
  it('localizes FileTooLargeError in Turkish and English', () => {
    // Stub localStorage and document if running in Node environment
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, val),
      removeItem: (key: string) => storage.delete(key),
    });

    const mockElement = {
      lang: '',
    };
    vi.stubGlobal('document', {
      documentElement: mockElement,
      querySelectorAll: () => [],
    });

    const error = new FileTooLargeError(73 * 1024 * 1024); // 73 MB

    // Test Turkish locale
    setLanguage('tr');
    const trText = errorText(error);
    expect(trText).toBe('Dosya çok büyük (73 MB). En fazla 50 MB olabilir.');
    expect(trText).not.toContain('File is too large');

    // Test English locale
    setLanguage('en');
    const enText = errorText(error);
    expect(enText).toBe('File is too large (73 MB). Maximum is 50 MB.');

    vi.unstubAllGlobals();
  });
});
