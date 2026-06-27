const isProduction = process.env.APP_ENV === 'production';
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();
const easProjectId = process.env.EAS_PROJECT_ID || '069ee581-7d17-4142-8a8a-02549ea075bd';

if (isProduction && !apiUrl.startsWith('https://')) {
  throw new Error('Los builds de produccion requieren EXPO_PUBLIC_API_URL con una URL HTTPS.');
}

module.exports = {
  expo: {
    owner: 'sofimotomompox',
    name: 'Mototaxi Mompox',
    slug: 'mototaxi-mompox',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'mototaximompox',
    plugins: [
      'expo-secure-store',
      [
        'expo-notifications',
        {
          icon: './assets/android-icon-monochrome.png',
          color: '#146C5F',
          defaultChannel: 'viajes',
        },
      ],
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.mototaximompox.app',
    },
    android: {
      package: 'com.mototaximompox.app',
      versionCode: 1,
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      appEnvironment: isProduction ? 'production' : 'development',
      eas: {
        projectId: easProjectId,
      },
    },
  },
};
