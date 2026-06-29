import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eduplayconnect.quire',
  appName: 'Quire',
  webDir: 'dist',
  android: {
    backgroundColor: '#ffffffff',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
