import { ScreenOrientation } from '@capacitor/screen-orientation';
import { drainCrashMarker, recordError } from './native/error-log';
import { initApp } from './ui/app';

// Registered before initApp() runs, deliberately: a throw during init leaves no
// toast, no screen and no native crash, so nothing else in the app would ever
// see it. Everything below this point is covered.
window.addEventListener('error', (event) => {
  recordError('uncaught', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  recordError('rejection', event.reason);
});

// Picks up a marker left by BinderyCrashListener.java if the previous run's
// WebView renderer died.
void drainCrashMarker();

void ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
initApp();
