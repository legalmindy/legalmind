import { QueryClient } from '@tanstack/react-query';
import { logError } from './errorLogger';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true
    },
    mutations: {
      retry: false,
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'خطأ غير معروف';
        void logError(message, { source: 'mutation' });
      }
    }
  }
});
