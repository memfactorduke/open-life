import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: "Mem's Life",
  slug: 'mems-life',
  version: '0.1.0',
  scheme: 'memslife',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.memslife.mobile',
    infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
  },
  plugins: ['expo-secure-store', ['expo-build-properties', { ios: { enableSceneSupport: true } }]],
};

export default config;
