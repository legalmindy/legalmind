import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export const platformOperatorQueryKey = ['platform-operator'] as const;

export async function fetchIsPlatformOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_operator');
  if (error) {
    if (error.message.includes('is_platform_operator')) return false;
    throw error;
  }
  return Boolean(data);
}

export function usePlatformOperator(enabled = true) {
  return useQuery({
    queryKey: platformOperatorQueryKey,
    queryFn: fetchIsPlatformOperator,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000
  });
}
