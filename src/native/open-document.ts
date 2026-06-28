import { registerPlugin } from '@capacitor/core';

interface OpenDocumentPlugin {
  pickPdf(): Promise<{ uri?: string }>;
}

const OpenDocument = registerPlugin<OpenDocumentPlugin>('OpenDocument');

/**
 * Like `pickPdf()` in `file-bridge.ts`, but via Android's SAF document
 * picker (`ACTION_OPEN_DOCUMENT`) instead of `ACTION_GET_CONTENT` — only
 * SAF grants can be made persistable, which "Son Okunanlar" depends on to
 * reopen a file after the app process has restarted.
 */
export async function pickPdfWithPersistentUri(): Promise<{ uri: string } | null> {
  const result = await OpenDocument.pickPdf();
  return result.uri ? { uri: result.uri } : null;
}
