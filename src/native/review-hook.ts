import { Preferences } from '@capacitor/preferences';
import { shareText } from './file-bridge';
import { t } from '../i18n';

export const PREF_SUCCESSFUL_OPS_COUNT = 'bindery_successful_ops_count';
export const PREF_LAST_REVIEW_PROMPT = 'bindery_last_review_prompt_time';
export const PREF_REVIEW_COMPLETED = 'bindery_review_completed';

export const STORE_URL = 'https://play.google.com/store/apps/details?id=com.eduplayconnect.bindery';
export const MARKET_URI = 'market://details?id=com.eduplayconnect.bindery';

export const MIN_OPS_FOR_REVIEW = 2;
export const PROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Records a completed successful document operation (save, export, or print).
 * Returns the updated total count.
 */
export async function recordSuccessfulOperation(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: PREF_SUCCESSFUL_OPS_COUNT });
    const current = Number.parseInt(value || '0', 10);
    const updated = Number.isFinite(current) ? current + 1 : 1;
    await Preferences.set({ key: PREF_SUCCESSFUL_OPS_COUNT, value: String(updated) });
    return updated;
  } catch (err) {
    console.warn('Could not increment operation count in Preferences:', err);
    return 0;
  }
}

/**
 * Checks if the user is eligible for an in-app review prompt.
 */
export async function isReviewEligible(): Promise<boolean> {
  try {
    const { value: completed } = await Preferences.get({ key: PREF_REVIEW_COMPLETED });
    if (completed === 'true') return false;

    const { value: countVal } = await Preferences.get({ key: PREF_SUCCESSFUL_OPS_COUNT });
    const count = Number.parseInt(countVal || '0', 10);
    if (!Number.isFinite(count) || count < MIN_OPS_FOR_REVIEW) return false;

    const { value: lastPromptVal } = await Preferences.get({ key: PREF_LAST_REVIEW_PROMPT });
    const lastPrompt = Number.parseInt(lastPromptVal || '0', 10);
    const now = Date.now();
    if (Number.isFinite(lastPrompt) && now - lastPrompt < PROMPT_INTERVAL_MS) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the Google Play store listing for Bindery.
 */
export async function openStoreListing(): Promise<void> {
  try {
    if (typeof window !== 'undefined') {
      // In Capacitor Android WebView, window.location.href triggers shouldOverrideUrlLoading,
      // which launches an ACTION_VIEW Intent directly to the Play Store app or browser.
      window.location.href = STORE_URL;
    }
  } catch (err) {
    console.warn('Failed to open store listing:', err);
  }
}

/**
 * Marks the review as completed so the user is never bothered again.
 */
export async function markReviewCompleted(): Promise<void> {
  try {
    await Preferences.set({ key: PREF_REVIEW_COMPLETED, value: 'true' });
  } catch (err) {
    console.warn('Could not mark review completed in Preferences:', err);
  }
}

/**
 * Marks the timestamp when a review prompt was shown to respect the cooldown period.
 */
export async function recordReviewPromptShown(): Promise<void> {
  try {
    await Preferences.set({ key: PREF_LAST_REVIEW_PROMPT, value: String(Date.now()) });
  } catch (err) {
    console.warn('Could not record review prompt time in Preferences:', err);
  }
}

/**
 * Shares Bindery app via Android ACTION_SEND intent.
 */
export async function shareBinderyApp(): Promise<void> {
  const title = t('growth.shareTitle');
  const text = t('growth.shareText');
  await shareText(text, title);
}
