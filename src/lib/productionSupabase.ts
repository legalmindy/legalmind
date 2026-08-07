/**
 * Production Supabase defaults for LegalMind Yemen.
 * Used when VITE_* is missing or points at a retired project so Android/Web
 * never ship a dead backend. The anon key is a public client key (RLS enforces
 * access) — not a secret service-role key.
 */
export const PRODUCTION_SUPABASE_URL = "https://gnsjjsvugafxkwgmvcev.supabase.co" as const;
export const PRODUCTION_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imduc2pqc3Z1Z2FmeGt3Z212Y2V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjQ3OTcsImV4cCI6MjA5NjQwMDc5N30.eh8hKRrm-5F89V2w3Q7i1k4QStiP0LHSGJVdQq4H3Ko" as const;
