import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types/app';
import {
  fetchCurrentUser,
  fetchCurrentUserWithRepairDetails,
  acceptInvitation,
  onAuthStateChange,
  registerInvitedUser,
  registerLawyer,
  registerOffice,
  resetPassword,
  signIn,
  signOut,
  signUp,
  updatePassword,
  verifyMfaLogin,
  resendVerificationEmail,
  type AuthResult,
  type InvitedUserRegistrationData,
  type LawyerRegistrationData,
  type OfficeRegistrationData,
  type SignUpData
} from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isConfigured: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (data: SignUpData) => Promise<AuthResult>;
  registerOffice: (data: OfficeRegistrationData) => Promise<AuthResult>;
  registerLawyer: (data: LawyerRegistrationData) => Promise<AuthResult>;
  registerInvitedUser: (data: InvitedUserRegistrationData) => Promise<AuthResult>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<AuthResult>;
  changePassword: (password: string) => Promise<AuthResult>;
  verifyMfa: (factorId: string, code: string) => Promise<AuthResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  acceptInvite: (token: string) => Promise<AuthResult>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  let isConfigured = false;
  try {
    isConfigured = isSupabaseConfigured();
  } catch (err) {
    console.error('Error checking Supabase configuration:', err);
    isConfigured = false;
  }

  useEffect(() => {
    if (!isConfigured) {
      console.warn('Supabase is not configured. Authentication features will be disabled.');
      setIsLoading(false);
      return;
    }

    let mounted = true;
    // Flag: true once the initial fetchCurrentUser() completes.
    // onAuthStateChange must NOT touch isLoading before this point to
    // prevent the "flash to landing on refresh" race condition.
    let initialLoadDone = false;

    // ── 1. Primary init ──────────────────────────────────────────────────
    // fetchCurrentUser() calls supabase.auth.getUser() which validates the
    // stored token against the server. This is the single source of truth
    // for the first load; it sets isLoading → false exactly once.
    fetchCurrentUserWithRepairDetails()
      .then(async ({ user: u }) => {
        if (!mounted) return;
        if (u === null) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            console.warn('[AUTH] Active JWT but no profile found — signing out orphan session.');
            await signOut();
          }
        }
        setUser(u);
      })
      .catch((err) => {
        console.error('[AUTH] Initial user fetch failed:', err);
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
          initialLoadDone = true;
        }
      });

    // ── 2. Subsequent change listener ────────────────────────────────────
    // We only allow this to mutate `user` AFTER the initial load finishes.
    // This prevents the Supabase SDK from emitting a transient null event
    // (that can arrive before INITIAL_SESSION) from flipping the user out.
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const { data } = onAuthStateChange((u) => {
        if (!mounted) return;
        if (!initialLoadDone) return; // ignore events during initial load
        setUser(u);
      });
      subscription = data.subscription;
    } catch (err) {
      console.error('[AUTH] onAuthStateChange setup failed:', err);
    }

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [isConfigured]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await signIn(email, password);

    if (!result.success) {
      return result;
    }

    const { user: u, repair } = await fetchCurrentUserWithRepairDetails();
    if (!u) {
      await signOut();
      const repairHint =
        repair.error ??
        (repair.ok
          ? 'تم ربط الحساب لكن تعذّر تحميل الملف. أعد المحاولة أو طبّق migration 054 في Supabase.'
          : 'تعذر إكمال تسجيل الدخول — حسابك غير مربوط بمكتب. جرّب «تسجيل مكتب» أو تواصل مع الدعم.');
      return {
        success: false,
        error: repairHint
      };
    }

    setUser(u);
    return result;
  }, []);

  const register = useCallback(async (data: SignUpData) => {
    if (import.meta.env.DEV) console.log('[AUTH CONTEXT] Registration attempt');
    return signUp(data);
  }, []);
  const registerOfficeAccount = useCallback(async (data: OfficeRegistrationData) => registerOffice(data), []);
  const registerLawyerAccount = useCallback(async (data: LawyerRegistrationData) => registerLawyer(data), []);
  const registerInvitedAccount = useCallback(async (data: InvitedUserRegistrationData) => registerInvitedUser(data), []);

  const logout = useCallback(async () => {
    if (import.meta.env.DEV) console.log('[AUTH CONTEXT] Logout attempt');
    await signOut();
    setUser(null);
    if (import.meta.env.DEV) console.log('[AUTH CONTEXT] Logout complete');
  }, []);

  const forgotPassword = useCallback(async (email: string) => resetPassword(email), []);
  const changePassword = useCallback(async (password: string) => updatePassword(password), []);
  const verifyMfa = useCallback(async (factorId: string, code: string) => {
    const result = await verifyMfaLogin(factorId, code);
    if (result.success) {
      const u = await fetchCurrentUser();
      setUser(u);
    }
    return result;
  }, []);
  const resendVerification = useCallback(async (email: string) => resendVerificationEmail(email), []);
  const acceptInvite = useCallback(async (token: string) => {
    const result = await acceptInvitation(token);
    if (result.success) {
      const u = await fetchCurrentUser();
      setUser(u);
    }
    return result;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await fetchCurrentUser();
    setUser(u);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      isConfigured,
      login,
      register,
      registerOffice: registerOfficeAccount,
      registerLawyer: registerLawyerAccount,
      registerInvitedUser: registerInvitedAccount,
      logout,
      forgotPassword,
      changePassword,
      verifyMfa,
      resendVerification,
      acceptInvite,
      refreshUser
    }),
    [user, isLoading, isConfigured, login, register, registerOfficeAccount, registerLawyerAccount, registerInvitedAccount, logout, forgotPassword, changePassword, verifyMfa, resendVerification, acceptInvite, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
