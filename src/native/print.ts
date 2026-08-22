import { Capacitor, registerPlugin } from '@capacitor/core';

interface PrintPlugin {
  /** `uri` is a location on disk, never the bytes — see `printPdf` in file-bridge.ts. */
  printPdf(options: { uri: string; jobName: string }): Promise<void>;
}

const Print = registerPlugin<PrintPlugin>('Print');

/** Whether the system print dialog can be reached on this platform. */
export function canPrint(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Opens Android's system print dialog for a PDF already written to disk.
 *
 * Deliberately takes a URI rather than bytes: the dialog is reached through the
 * standard print framework, which works with any printer via Mopria or the
 * vendor's print service, and the file is streamed by the plugin instead of
 * being pushed through the Capacitor bridge.
 *
 * Callers should check {@link canPrint} first; off Android this rejects rather
 * than silently doing nothing, so a mis-wired UI is visible instead of dead.
 */
export async function printPdfUri(uri: string, jobName: string): Promise<void> {
  await Print.printPdf({ uri, jobName });
}
