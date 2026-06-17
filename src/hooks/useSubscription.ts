import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFirmPayments,
  fetchFirmSaasSubscriptions,
  fetchFirmSubscriptionWithCache,
  fetchPendingPaymentsAdmin,
  fetchPendingSubscriptionRequestsAdmin,
  fetchSubscriptionRequests,
  readCachedFirmSubscription,
  reviewPayment,
  reviewSubscriptionRequest
} from '../lib/subscription';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export const subscriptionQueryKeys = {
  firm: ['firm-subscription'] as const,
  saas: ['firm-saas-subscriptions'] as const,
  payments: ['firm-payments'] as const,
  requests: ['subscription-requests'] as const,
  adminPending: ['admin-subscription-requests'] as const,
  adminPayments: ['admin-pending-payments'] as const
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

export function useFirmSaasSubscriptions(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.saas,
    queryFn: fetchFirmSaasSubscriptions,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000
  });
}

export function useFirmPayments(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.payments,
    queryFn: fetchFirmPayments,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000
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

export function useAdminPendingPayments(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.adminPayments,
    queryFn: fetchPendingPaymentsAdmin,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 10_000
  });
}

/** @deprecated Use useAdminPendingPayments */
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
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.adminPayments });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.firm });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.saas });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.payments });
    }
  });
}

export function usePaymentReviewMutations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reviewPayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.adminPending });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.adminPayments });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.requests });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.firm });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.saas });
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.payments });
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
