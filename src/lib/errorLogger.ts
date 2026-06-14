import { supabase } from './supabaseClient';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

interface ErrorContext {
  [key: string]: string | number | boolean | undefined;
}

const errorBuffer: Array<{ message: string; stack?: string; context?: ErrorContext; severity: ErrorSeverity; ts: number }> = [];

export async function logError(
  message: string,
  context?: ErrorContext,
  severity: ErrorSeverity = 'error'
): Promise<void> {
  const entry = {
    message: sanitizeMessage(message),
    stack: new Error().stack,
    context: context ? sanitizeContext(context) : undefined,
    severity,
    ts: Date.now()
  };

  errorBuffer.push(entry);
  if (errorBuffer.length > 100) errorBuffer.shift();

  if (import.meta.env.DEV) {
    console.error(`[LegalMind ${severity}]`, message, context);
  }

  try {
    await supabase.from('error_logs').insert({
      message: entry.message,
      stack: entry.stack?.slice(0, 4000),
      context: entry.context ?? null,
      severity
    });
  } catch {
    // Silently fail — don't recurse on logging errors
  }
}

export function getRecentErrors() {
  return [...errorBuffer];
}

function sanitizeMessage(msg: string): string {
  return msg.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]');
}

function sanitizeContext(ctx: ErrorContext): ErrorContext {
  const safe: ErrorContext = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization'];
  for (const [k, v] of Object.entries(ctx)) {
    if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
      safe[k] = '[REDACTED]';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}
