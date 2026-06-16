import type { ReactNode } from 'react';
import type { PageId } from '../types/app';
import { PageLoader } from './ui/LoadingSpinner';
import { SubscriptionLockScreen } from './SubscriptionLockScreen';
import { isSubscriptionBlocked, useFirmSubscription } from '../hooks/useSubscription';
import { readCachedFirmSubscription } from '../lib/subscription';

const UNLOCKED_PAGES: PageId[] = ['subscription', 'profile', 'admin-billing'];

interface SubscriptionGuardProps {
  isAuthenticated: boolean;
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function SubscriptionGuard({
  isAuthenticated,
  currentPage,
  onNavigate,
  onLogout,
  children
}: SubscriptionGuardProps) {
  const { data: subscription, isLoading } = useFirmSubscription(isAuthenticated);
  const effectiveSubscription = subscription ?? readCachedFirmSubscription() ?? undefined;
  const blocked = isAuthenticated && !isLoading && isSubscriptionBlocked(effectiveSubscription);

  if (isAuthenticated && isLoading && !effectiveSubscription) {
    return <PageLoader label="جاري التحقق من الاشتراك..." />;
  }

  if (!blocked) return <>{children}</>;

  if (UNLOCKED_PAGES.includes(currentPage)) return <>{children}</>;

  return (
    <SubscriptionLockScreen
      expiresAt={effectiveSubscription?.expiresAt}
      onRenew={() => onNavigate('subscription')}
      onLogout={onLogout}
    />
  );
}
