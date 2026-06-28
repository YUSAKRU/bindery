import { App, type URLOpenListenerEvent } from '@capacitor/app';

/**
 * Covers both ways a PDF can arrive via Android's "Open with": cold start
 * (app wasn't running — `getLaunchUrl()` reads the launch intent's URI) and
 * warm start (app already running, brought to front via `onNewIntent` —
 * fires as the `appUrlOpen` event instead).
 */
export function setupIncomingPdfLinks(onUrl: (url: string) => void): void {
  void App.getLaunchUrl().then((result) => {
    if (result?.url) onUrl(result.url);
  });

  void App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    onUrl(event.url);
  });
}
