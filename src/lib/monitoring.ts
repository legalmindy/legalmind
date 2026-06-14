import { logError } from './errorLogger';

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

const metrics: PerformanceMetric[] = [];

export function trackPerformance(name: string, startTime: number): void {
  const duration = performance.now() - startTime;
  metrics.push({ name, duration, timestamp: Date.now() });
  if (metrics.length > 200) metrics.shift();

  if (import.meta.env.DEV) {
    console.debug(`[Perf] ${name}: ${duration.toFixed(1)}ms`);
  }

  if (duration > 5000) {
    void logError(`Slow operation: ${name} took ${duration.toFixed(0)}ms`, { name, duration }, 'warning');
  }
}

export function withPerformanceTracking<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  return fn().finally(() => trackPerformance(name, start));
}

export function getMetrics(): PerformanceMetric[] {
  return [...metrics];
}

export function reportWebVitals(): void {
  if (typeof window === 'undefined') return;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'navigation') {
        const nav = entry as PerformanceNavigationTiming;
        trackPerformance('page_load', nav.loadEventEnd);
      }
    }
  });

  try {
    observer.observe({ entryTypes: ['navigation'] });
  } catch {
    // PerformanceObserver not supported
  }
}
