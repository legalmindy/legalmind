import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types/app';
import {
  fetchCurrentUser,
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
import { isSupabaseConfigured } from '../lib/supabaseClient';

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
    
    fetchCurrentUser()
      .then((u) => {
        if (mounted) {
          setUser(u);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching current user:', err);
        if (mounted) {
          setIsLoading(false);
        }
      });

    try {
      const { data: { subscription } } = onAuthStateChange((u) => {
        if (mounted) {
          setUser(u);
          setIsLoading(false);
        }
      });

      return () => { 
        subscription.unsubscribe(); 
        mounted = false;
      };
    } catch (err) {
      console.error('Error setting up auth state change listener:', err);
      if (mounted) {
        setIsLoading(false);
      }
      return () => { mounted = false; };
    }
  }, [isConfigured]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await signIn(email, password);

    if (!result.success) {
      return result;
    }

    const u = await fetchCurrentUser();
    if (!u) {
      await signOut();
      return {
        success: false,
        error: 'تم التحقق من الحساب لكن ملف المستخدم غير مكتمل. تأكد من وجود سجل في profiles أو employees.'
      };
    }

    setUser(u);
    return result;
  }, []);

  const register = useCallback(async (data: SignUpData) => {
    console.log('[AUTH CONTEXT] Registration attempt for email:', data.email);
    return signUp(data);
  }, []);
  const registerOfficeAccount = useCallback(async (data: OfficeRegistrationData) => registerOffice(data), []);
  const registerLawyerAccount = useCallback(async (data: LawyerRegistrationData) => registerLawyer(data), []);
  const registerInvitedAccount = useCallback(async (data: InvitedUserRegistrationData) => registerInvitedUser(data), []);

  const logout = useCallback(async () => {
    console.log('[AUTH CONTEXT] Logout attempt');
    await signOut();
    setUser(null);
    console.log('[AUTH CONTEXT] Logout complete');
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
