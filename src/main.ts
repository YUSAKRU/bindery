import { ScreenOrientation } from '@capacitor/screen-orientation';
import { initApp } from './ui/app';

void ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
initApp();
