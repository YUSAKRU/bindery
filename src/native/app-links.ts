import { App, type URLOpenListenerEvent } from '@capacitor/app';

let registered = false;

function isValidPdfUri(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // content:// URIs arrive via Android's SAF, already MIME-filtered by the manifest.
  // file:// URIs must carry a .pdf extension.
  return lower.startsWith('content://') || lower.endsWith('.pdf');
}

/**
 * Covers both ways a PDF can arrive via Android's "Open with": cold start
 * (app wasn't running — `getLaunchUrl()` reads the launch intent's URI) and
 * warm start (app already running, brought to front via `onNewIntent` —
 * fires as the `appUrlOpen` event instead).
 *
 * Idempotent: subsequent calls are no-ops, preventing listener accumulation
 * on HMR or accidental re-invocation.
 */
export function setupIncomingPdfLinks(onUrl: (url: string) => void): void {
  if (registered) return;
  registered = true;

  void App.getLaunchUrl().then((result) => {
    if (result?.url && isValidPdfUri(result.url)) onUrl(result.url);
  });

  void App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    if (isValidPdfUri(event.url)) onUrl(event.url);
  });
}
