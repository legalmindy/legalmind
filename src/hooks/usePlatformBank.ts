import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPlatformBankDetails, platformBankQueryKey, savePlatformBankDetails } from '../lib/platformBank';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import type { PlatformBankDetails } from '../types/app';

export function usePlatformBankDetails(enabled = true) {
  return useQuery({
    queryKey: platformBankQueryKey,
    queryFn: fetchPlatformBankDetails,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000
  });
}

export function usePlatformBankMutations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformBankDetails) => savePlatformBankDetails(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformBankQueryKey });
    }
  });
}
