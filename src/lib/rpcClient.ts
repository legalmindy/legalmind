import { supabase } from './supabaseClient';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 400;

function isTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch')
    || lower.includes('network')
    || lower.includes('connection')
    || lower.includes('timeout')
    || lower.includes('abort')
    || lower.includes('502')
    || lower.includes('503')
    || lower.includes('504')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('RPC timeout')), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  options?: { timeoutMs?: number; retries?: number }
): Promise<{ data: T | null; error: Error | null }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options?.retries ?? DEFAULT_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { data, error } = await withTimeout(supabase.rpc(fn, args), timeoutMs);
      if (error) {
        lastError = new Error(error.message);
        if (attempt < retries && isTransientError(error.message)) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        return { data: null, error: lastError };
      }
      return { data: data as T, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = new Error(message);
      if (attempt < retries && isTransientError(message)) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return { data: null, error: lastError };
    }
  }

  return { data: null, error: lastError };
}
