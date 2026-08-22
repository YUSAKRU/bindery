import { Capacitor, registerPlugin } from '@capacitor/core';

interface OpenDocumentPlugin {
  pickPdf(): Promise<{ uri?: string; persistent?: boolean }>;
}

const OpenDocument = registerPlugin<OpenDocumentPlugin>('OpenDocument');

/**
 * Like `pickPdf()` in `file-bridge.ts`, but via Android's SAF document
 * picker (`ACTION_OPEN_DOCUMENT`) instead of `ACTION_GET_CONTENT` — only
 * SAF grants can be made persistable, which "Son Okunanlar" depends on to
 * reopen a file after the app process has restarted.
 *
 * Returns null on non-Android platforms (plugin not available) or when the
 * user cancels. The `persistent` flag indicates whether the URI permission
 * was successfully persisted; callers should pass `null` as the stored URI
 * when `persistent` is false so recents does not try to reopen it later.
 */
export async function pickPdfWithPersistentUri(): Promise<{ uri: string; persistent: boolean } | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const result = await OpenDocument.pickPdf();
  if (!result.uri) return null;
  return { uri: result.uri, persistent: result.persistent !== false };
}
