import type { ReactNode } from 'react';
import type { PageId } from '../types/app';
import { SubscriptionLockScreen } from './SubscriptionLockScreen';
import { isSubscriptionBlocked, useFirmSubscription } from '../hooks/useSubscription';

const UNLOCKED_PAGES: PageId[] = ['subscription', 'profile'];

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
  const blocked = isAuthenticated && !isLoading && isSubscriptionBlocked(subscription);

  if (!blocked) return <>{children}</>;

  if (UNLOCKED_PAGES.includes(currentPage)) return <>{children}</>;

  return (
    <SubscriptionLockScreen
      expiresAt={subscription?.expiresAt}
      onRenew={() => onNavigate('subscription')}
      onLogout={onLogout}
    />
  );
}
