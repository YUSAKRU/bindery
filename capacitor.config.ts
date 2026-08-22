import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eduplayconnect.bindery',
  appName: 'Bindery',
  webDir: 'dist',
  android: {
    backgroundColor: '#ffffffff',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
