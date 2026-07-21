import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { PageLoader } from './components/ui/LoadingSpinner';
import { queryClient } from './lib/queryClient';
import App from './App';
import './styles/index.css';
import { reportWebVitals } from './lib/monitoring';
import { initNativeApp } from './lib/platform/initNativeApp';
import { isNativeApp } from './lib/platform';

async function loadFonts() {
  if (isNativeApp()) {
    await Promise.all([
      import('@fontsource/cairo/400.css'),
      import('@fontsource/cairo/600.css'),
      import('@fontsource/cairo/700.css')
    ]);
    return;
  }
  await Promise.all([
    import('@fontsource/cairo/400.css'),
    import('@fontsource/cairo/600.css'),
    import('@fontsource/cairo/700.css'),
    import('@fontsource/cairo/800.css'),
    import('@fontsource/cairo/900.css')
  ]);
}

async function bootstrap() {
  await Promise.all([loadFonts(), initNativeApp()]);
  reportWebVitals();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Suspense fallback={<PageLoader />}>
              <App />
            </Suspense>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
