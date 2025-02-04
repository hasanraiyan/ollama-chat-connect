import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.lovable.ollama.chat',
  appName: 'Ollama Chat',
  webDir: 'dist',
  server: {
    url: 'https://REPLACE_WITH_PROJECT_ID.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  ios: {
    contentInset: 'automatic'
  },
  android: {
    allowMixedContent: true
  }
};

export default config;