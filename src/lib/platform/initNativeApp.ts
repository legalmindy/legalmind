import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNativeApp, prefersDarkMode } from './index';

export async function initNativeApp(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-app', `platform-${Capacitor.getPlatform()}`);

  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#7A1F2B' });
  } catch {
    /* StatusBar unavailable on some devices */
  }

  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch {
    /* optional */
  }

  applyColorScheme();
  if (typeof window.matchMedia !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyColorScheme);
  }

  window.setTimeout(() => {
    void SplashScreen.hide({ fadeOutDuration: 400 });
  }, 600);
}

/** Dark mode is a native-app-only feature; the website always keeps its original light design. */
export function applyColorScheme(): void {
  if (!Capacitor.isNativePlatform()) return;
  const dark = prefersDarkMode();
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export async function subscribeNativeNetwork(
  onOnline: () => void,
  onOffline: () => void
): Promise<() => void> {
  if (!isNativeApp()) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }

  const handler = Network.addListener('networkStatusChange', (status) => {
    if (status.connected) onOnline();
    else onOffline();
  });

  const status = await Network.getStatus();
  if (!status.connected) onOffline();

  return () => {
    void handler.then((h) => h.remove());
  };
}

export async function registerAndroidBackButton(
  onBack: () => boolean | Promise<boolean>
): Promise<() => void> {
  if (!isNativeApp() || Capacitor.getPlatform() !== 'android') {
    return () => undefined;
  }

  const handler = await CapApp.addListener('backButton', ({ canGoBack }) => {
    void (async () => {
      const handled = await onBack();
      if (!handled && !canGoBack) {
        await CapApp.exitApp();
      }
    })();
  });

  return () => {
    void handler.remove();
  };
}

export async function confirmExitApp(message: string): Promise<boolean> {
  return window.confirm(message);
}
