import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFirmSubscriptionWithCache,
  fetchPendingSubscriptionRequestsAdmin,
  fetchSubscriptionRequests,
  readCachedFirmSubscription,
  reviewSubscriptionRequest
} from '../lib/subscription';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export const subscriptionQueryKeys = {
  firm: ['firm-subscription'] as const,
  requests: ['subscription-requests'] as const,
  adminPending: ['admin-subscription-requests'] as const
};

export function useFirmSubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.firm,
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        const cached = readCachedFirmSubscription();
        if (cached) return cached;
        throw new Error('Supabase غير مهيأ');
      }
      return fetchFirmSubscriptionWithCache();
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: () => readCachedFirmSubscription() ?? undefined
  });
}

export function useSubscriptionRequests(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.requests,
    queryFn: fetchSubscriptionRequests,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000
  });
}

export function useAdminPendingSubscriptionRequests(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.adminPending,
    queryFn: fetchPendingSubscriptionRequestsAdmin,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 10_000
  });
}

export function useSubscriptionReviewMutations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reviewSubscriptionRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.adminPending });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.firm });
    }
  });
}

export function isSubscriptionBlocked(
  subscription: { isLocked: boolean; expiresAt: string | null; status: string } | undefined
): boolean {
  const cached = readCachedFirmSubscription();
  const state = subscription ?? cached;
  if (!state) return false;
  if (state.isLocked) return true;
  if (state.status === 'expired') return true;
  if (state.expiresAt && new Date(state.expiresAt).getTime() <= Date.now()) return true;
  return false;
}
