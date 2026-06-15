import { useQuery } from '@tanstack/react-query';
import { fetchFirmSubscription, fetchSubscriptionRequests } from '../lib/subscription';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { isOnline } from '../lib/syncEngine';

export const subscriptionQueryKeys = {
  firm: ['firm-subscription'] as const,
  requests: ['subscription-requests'] as const
};

export function useFirmSubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.firm,
    queryFn: fetchFirmSubscription,
    enabled: enabled && isSupabaseConfigured() && isOnline(),
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useSubscriptionRequests(enabled = true) {
  return useQuery({
    queryKey: subscriptionQueryKeys.requests,
    queryFn: fetchSubscriptionRequests,
    enabled: enabled && isSupabaseConfigured() && isOnline(),
    staleTime: 15_000
  });
}

export function isSubscriptionBlocked(
  subscription: { isLocked: boolean; expiresAt: string | null; status: string } | undefined
): boolean {
  if (!subscription) return false;
  if (subscription.isLocked) return true;
  if (subscription.status === 'expired') return true;
  if (subscription.expiresAt && new Date(subscription.expiresAt).getTime() <= Date.now()) return true;
  return false;
}
