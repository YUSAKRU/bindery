import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));

vi.mock('./file-bridge', () => ({
  shareText: vi.fn(async () => {}),
}));

import {
  isReviewEligible,
  markReviewCompleted,
  MIN_OPS_FOR_REVIEW,
  openStoreListing,
  PREF_LAST_REVIEW_PROMPT,
  PREF_REVIEW_COMPLETED,
  PREF_SUCCESSFUL_OPS_COUNT,
  PROMPT_INTERVAL_MS,
  recordReviewPromptShown,
  recordSuccessfulOperation,
  shareBinderyApp,
} from './review-hook';
import { shareText } from './file-bridge';

describe('In-App Review & Share Hook', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('increments operation count on recordSuccessfulOperation', async () => {
    const count1 = await recordSuccessfulOperation();
    expect(count1).toBe(1);
    expect(store.get(PREF_SUCCESSFUL_OPS_COUNT)).toBe('1');

    const count2 = await recordSuccessfulOperation();
    expect(count2).toBe(2);
    expect(store.get(PREF_SUCCESSFUL_OPS_COUNT)).toBe('2');
  });

  it('returns false for isReviewEligible when count is below threshold', async () => {
    expect(await isReviewEligible()).toBe(false);

    await recordSuccessfulOperation(); // 1
    expect(await isReviewEligible()).toBe(false);
  });

  it('returns true for isReviewEligible when count reaches threshold', async () => {
    for (let i = 0; i < MIN_OPS_FOR_REVIEW; i++) {
      await recordSuccessfulOperation();
    }
    expect(await isReviewEligible()).toBe(true);
  });

  it('returns false when review is already marked completed', async () => {
    for (let i = 0; i < MIN_OPS_FOR_REVIEW; i++) {
      await recordSuccessfulOperation();
    }
    await markReviewCompleted();
    expect(store.get(PREF_REVIEW_COMPLETED)).toBe('true');
    expect(await isReviewEligible()).toBe(false);
  });

  it('enforces cooldown interval after prompt was shown', async () => {
    for (let i = 0; i < MIN_OPS_FOR_REVIEW; i++) {
      await recordSuccessfulOperation();
    }
    expect(await isReviewEligible()).toBe(true);

    await recordReviewPromptShown();
    expect(await isReviewEligible()).toBe(false);

    // After cooldown passes
    const oldTime = Date.now() - (PROMPT_INTERVAL_MS + 1000);
    store.set(PREF_LAST_REVIEW_PROMPT, String(oldTime));
    expect(await isReviewEligible()).toBe(true);
  });

  it('invokes shareText when shareBinderyApp is called', async () => {
    await shareBinderyApp();
    expect(shareText).toHaveBeenCalledWith(
      expect.stringContaining('Bindery'),
      expect.stringContaining('play.google.com'),
    );
  });

  it('opens store URL without crashing', async () => {
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    const openMock = vi.fn();
    (globalThis as unknown as { window?: unknown }).window = { open: openMock };
    try {
      await openStoreListing();
      expect(openMock).toHaveBeenCalledWith(expect.stringContaining('play.google.com'), '_blank');
    } finally {
      (globalThis as unknown as { window?: unknown }).window = originalWindow;
    }
  });
});
