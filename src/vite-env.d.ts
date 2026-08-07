/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_AUTH_SHARED_SESSION?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_VERSION_CODE?: string;
  /** When "true", logs non-OK Supabase HTTP responses (never request bodies). */
  readonly VITE_AUTH_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
