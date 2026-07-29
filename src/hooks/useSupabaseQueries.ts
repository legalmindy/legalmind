import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  localCaseRepository,
  localClientRepository,
  localDocumentRepository,
  localEmployeeRepository,
  localNotificationRepository,
  localOfficeRepository,
  localPeopleRepository,
  localSessionRepository
} from '../lib/repositories';
import {
  archiveCaseRecord,
  cancelInvitation,
  createCase,
  createClient,
  createEmployee,
  createSession,
  createExpense,
  deleteCaseRecord,
  deleteEmployeeRecord,
  deleteExpense,
  deleteSessionRecord,
  fetchAllCases,
  fetchAllClients,
  fetchArchivedCases,
  fetchCases,
  fetchClients,
  fetchDocuments,
  uploadDocumentFile,
  fetchEmployees,
  fetchExpenses,
  fetchInvitations,
  fetchLawyers,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  fetchOffice,
  fetchSessions,
  fetchUpcomingSessions,
  inviteOfficeUser,
  resendInvitation,
  restoreCaseRecord,
  softDeleteClient,
  toggleEmployeeStatusRecord,
  updateCaseRecord,
  updateClientRecord,
  updateEmployeeRecord,
  updateOffice,
  updateSessionRecord
} from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { isOnline } from '../lib/syncEngine';
import { fetchFirmReceiptVouchers } from '../lib/receiptVoucher';
import type { ReceiptVoucher } from '../types/app';
import { useEffect, useRef } from 'react';
import type { PaginationParams } from '../types/database';
import type { Employee, CaseRecord, Client, Expense, Invitation, SessionItem } from '../types/app';
import { getCurrentProfileContext } from '../services/profileService';
import { filterUpcomingSessions } from '../lib/sessionAlerts';
import { mutateRemoteOrLocal } from '../lib/remoteMutation';
import { getCurrentFirmId } from '../lib/api';

async function fetchEmployeesWithFallback(): Promise<Employee[]> {
  if (isSupabaseConfigured() && isOnline()) {
    try {
      return await fetchEmployees();
    } catch (err) {
      console.error('[useEmployees] Supabase fetch failed, using local cache:', err);
    }
  }
  return localEmployeeRepository.list();
}

async function fetchLawyersWithFallback() {
  if (isSupabaseConfigured() && isOnline()) {
    try {
      return await fetchLawyers();
    } catch (err) {
      console.error('[useLawyers] Supabase fetch failed, using local cache:', err);
    }
  }
  return localPeopleRepository.listLawyers();
}

async function fetchCasesWithFallback(params?: PaginationParams): Promise<CaseRecord[]> {
  if (isSupabaseConfigured() && isOnline()) {
    try {
      if (params?.page || params?.pageSize || params?.search) {
        const result = await fetchCases(params);
        return result.data;
      }
      return await fetchAllCases();
    } catch (err) {
      console.error('[useCases] Supabase fetch failed, using local cache:', err);
    }
  }
  return localCaseRepository.list();
}

async function fetchClientsWithFallback(params?: PaginationParams): Promise<Client[]> {
  if (isSupabaseConfigured() && isOnline()) {
    try {
      if (params?.page || params?.pageSize || params?.search) {
        const result = await fetchClients(params);
        return result.data;
      }
      return await fetchAllClients();
    } catch (err) {
      console.error('[useClients] Supabase fetch failed, using local cache:', err);
    }
  }
  return localClientRepository.list();
}

async function fetchArchivedCasesWithFallback(): Promise<CaseRecord[]> {
  if (isSupabaseConfigured() && isOnline()) {
    try {
      return await fetchArchivedCases();
    } catch (err) {
      console.error('[useArchivedCases] Supabase fetch failed, using local cache:', err);
    }
  }
  return localCaseRepository.listArchived();
}

export const queryKeys = {
  clients: (params?: PaginationParams) => ['clients', params] as const,
  cases: (params?: PaginationParams) => ['cases', params] as const,
  archivedCases: ['cases', 'archived'] as const,
  employees: ['employees'] as const,
  invitations: ['invitations'] as const,
  office: ['office'] as const,
  firmProfile: ['firm-profile'] as const,
  sessions: ['sessions'] as const,
  upcomingSessions: ['upcoming-sessions'] as const,
  documents: ['documents'] as const,
  lawyers: ['lawyers'] as const,
  notifications: ['notifications'] as const,
  expenses: ['expenses'] as const,
  receiptVouchers: (year: number) => ['receipt-vouchers', year] as const
};

export function useClients(enabled = true, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.clients(params),
    queryFn: () => fetchClientsWithFallback(params),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useCases(enabled = true, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.cases(params),
    queryFn: () => fetchCasesWithFallback(params),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useArchivedCases(enabled = true) {
  return useQuery({
    queryKey: queryKeys.archivedCases,
    queryFn: fetchArchivedCasesWithFallback,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: fetchEmployeesWithFallback,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useInvitations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.invitations,
    queryFn: fetchInvitations,
    enabled,
    staleTime: 30_000
  });
}

export function useOffice(enabled = true) {
  return useQuery({
    queryKey: queryKeys.office,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        try {
          return await fetchOffice();
        } catch {
          return localOfficeRepository.get();
        }
      }
      return localOfficeRepository.get();
    },
    enabled,
    staleTime: 60_000
  });
}

export function useFirmProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.firmProfile,
    queryFn: getCurrentProfileContext,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000,
    retry: 1
  });
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        try {
          return await fetchSessions();
        } catch (err) {
          console.error('[useSessions] remote failed, using local:', err);
        }
      }
      return localSessionRepository.list();
    },
    enabled,
    staleTime: 60_000
  });
}

export function useUpcomingSessions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.upcomingSessions,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        try {
          return await fetchUpcomingSessions();
        } catch (err) {
          console.error('[useUpcomingSessions] remote failed, using local:', err);
        }
      }
      const local = await localSessionRepository.list();
      return filterUpcomingSessions(local);
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true
  });
}

export function useDocuments(enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        try {
          return await fetchDocuments();
        } catch (err) {
          console.error('[useDocuments] remote failed, using local:', err);
        }
      }
      return localDocumentRepository.list();
    },
    enabled,
    staleTime: 60_000
  });
}

export function useLawyers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.lawyers,
    queryFn: fetchLawyersWithFallback,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        try {
          return await fetchNotifications();
        } catch (err) {
          console.error('[useNotifications] remote failed, using local:', err);
        }
      }
      return localNotificationRepository.list();
    },
    enabled,
    staleTime: 30_000
  });
}

export function useClientMutations() {
  const queryClient = useQueryClient();
  const useRemote = () => isSupabaseConfigured() && isOnline();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['clients'] }); };

  return {
    addClient: useMutation({
      mutationFn: async (payload: Omit<Client, 'id' | 'casesCount' | 'createdAt'>) => {
        if (useRemote()) return createClient(payload);
        return localClientRepository.create(payload);
      },
      onSuccess: invalidate
    }),
    updateClient: useMutation({
      mutationFn: async (payload: Client) => {
        if (useRemote()) return updateClientRecord(payload);
        return localClientRepository.update(payload);
      },
      onSuccess: invalidate
    }),
    deleteClient: useMutation({
      mutationFn: async (id: string) => {
        if (useRemote()) return softDeleteClient(id);
        return localClientRepository.softDelete(id);
      },
      onSuccess: invalidate
    })
  };
}

export function useCaseMutations() {
  const queryClient = useQueryClient();
  const useRemote = () => isSupabaseConfigured() && isOnline();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.archivedCases });
  };
  return {
    addCase: useMutation({
      mutationFn: async (payload: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted' | 'remaining_amount'>) => {
        if (useRemote()) return createCase(payload);
        return localCaseRepository.create(payload);
      },
      onSuccess: invalidate
    }),
    updateCase: useMutation({
      mutationFn: async (payload: CaseRecord) => {
        if (useRemote()) return updateCaseRecord(payload);
        return localCaseRepository.update(payload);
      },
      onSuccess: invalidate
    }),
    restoreCase: useMutation({
      mutationFn: async (id: string) => {
        if (useRemote()) return restoreCaseRecord(id);
        return localCaseRepository.restore(id);
      },
      onSuccess: invalidate
    }),
    archiveCase: useMutation({
      mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
        if (useRemote()) return archiveCaseRecord(id, notes);
        return localCaseRepository.archive(id, notes);
      },
      onSuccess: invalidate
    }),
    deleteCase: useMutation({
      mutationFn: async (id: string) => {
        if (useRemote()) return deleteCaseRecord(id);
        return localCaseRepository.softDelete(id);
      },
      onSuccess: invalidate
    })
  };
}

export function useOfficeMutations() {
  const queryClient = useQueryClient();
  return {
    updateOffice: useMutation({
      mutationFn: (payload: Parameters<typeof updateOffice>[0]) =>
        mutateRemoteOrLocal(
          () => updateOffice(payload),
          () => localOfficeRepository.update(payload)
        ),
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.office }); }
    })
  };
}

export function useSessionMutations() {
  const queryClient = useQueryClient();
  const useRemote = () => isSupabaseConfigured() && isOnline();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.upcomingSessions });
  };

  return {
    createSession: useMutation({
      mutationFn: async (payload: Omit<SessionItem, 'id' | 'caseTitle'>) => {
        if (useRemote()) return createSession(payload);
        return localSessionRepository.create(payload);
      },
      onSuccess: invalidate
    }),
    updateSession: useMutation({
      mutationFn: async (payload: SessionItem) => {
        if (useRemote()) return updateSessionRecord(payload);
        return localSessionRepository.update(payload);
      },
      onSuccess: invalidate
    }),
    deleteSession: useMutation({
      mutationFn: async (id: string) => {
        if (useRemote()) return deleteSessionRecord(id);
        return localSessionRepository.softDelete(id);
      },
      onSuccess: invalidate
    })
  };
}

export function useDocumentMutations() {
  const queryClient = useQueryClient();
  return {
    uploadFile: useMutation({
      mutationFn: ({ file, caseId, title, category }: { file: File; caseId: string; title?: string; category?: string }) => {
        if (isSupabaseConfigured() && isOnline()) {
          return uploadDocumentFile(file, caseId, title, category);
        }
        return localDocumentRepository.upload(file, caseId);
      },
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.documents }); }
    })
  };
}

export function useEmployeeMutations() {
  const queryClient = useQueryClient();
  const invalidatePeople = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.employees });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lawyers });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
  };

  return {
    addEmployee: useMutation({
      mutationFn: (payload: Omit<Employee, 'id' | 'created_at'>) =>
        mutateRemoteOrLocal(
          () => createEmployee(payload),
          () => localEmployeeRepository.create(payload)
        ),
      onSuccess: invalidatePeople
    }),
    updateEmployee: useMutation({
      mutationFn: (payload: Employee) =>
        mutateRemoteOrLocal(
          () => updateEmployeeRecord(payload),
          () => localEmployeeRepository.update(payload)
        ),
      onSuccess: invalidatePeople
    }),
    toggleEmployeeStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: Employee['status'] }) =>
        mutateRemoteOrLocal(
          () => toggleEmployeeStatusRecord(id, status),
          () => localEmployeeRepository.toggleStatus(id, status)
        ),
      onSuccess: invalidatePeople
    }),
    deleteEmployee: useMutation({
      mutationFn: (id: string) =>
        mutateRemoteOrLocal(
          () => deleteEmployeeRecord(id),
          () => localEmployeeRepository.softDelete(id)
        ),
      onSuccess: invalidatePeople
    }),
    inviteEmployee: useMutation({
      mutationFn: inviteOfficeUser,
      onSuccess: invalidatePeople
    }),
    revokeInvitation: useMutation({
      mutationFn: cancelInvitation,
      onMutate: async (invitationId) => {
        await queryClient.cancelQueries({ queryKey: queryKeys.invitations });
        const previous = queryClient.getQueryData<Invitation[]>(queryKeys.invitations);
        queryClient.setQueryData(
          queryKeys.invitations,
          (current: Invitation[] | undefined) =>
            current?.filter((item) => item.id !== invitationId) ?? []
        );
        return { previous };
      },
      onError: (_err, _id, context) => {
        if (context?.previous) {
          queryClient.setQueryData(queryKeys.invitations, context.previous);
        }
      },
      onSettled: invalidatePeople
    }),
    resendInvitation: useMutation({
      mutationFn: resendInvitation,
      onSuccess: invalidatePeople
    })
  };
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const useRemote = () => isSupabaseConfigured() && isOnline();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); };

  return {
    createNotification: useMutation({
      mutationFn: localNotificationRepository.create, // notifications created locally then synced
      onSuccess: invalidate
    }),
    markNotificationRead: useMutation({
      mutationFn: async (id: string) => {
        if (useRemote()) return markNotificationRead(id);
        return localNotificationRepository.markRead(id);
      },
      onSuccess: invalidate
    }),
    markAllNotificationsRead: useMutation({
      mutationFn: async () => {
        if (useRemote()) return markAllNotificationsRead();
        return localNotificationRepository.markAllRead();
      },
      onSuccess: invalidate
    })
  };
}

export function useRealtimeNotifications(onNewNotification: () => void, enabled = true) {
  const callbackRef = useRef(onNewNotification);
  callbackRef.current = onNewNotification;

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void getCurrentFirmId()
      .then((firmId) => {
        if (cancelled) return;
        channel = supabase
          .channel(`notifications-${firmId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `firm_id=eq.${firmId}`
            },
            () => {
              callbackRef.current();
            }
          )
          .subscribe();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled]);
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export function useExpenses(enabled = true) {
  return useQuery<Expense[]>({
    queryKey: queryKeys.expenses,
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        return fetchExpenses();
      }
      return [];
    },
    enabled,
    staleTime: 60_000
  });
}

export function useExpenseMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: queryKeys.expenses }); };

  return {
    addExpense: useMutation({
      mutationFn: createExpense,
      onSuccess: invalidate
    }),
    removeExpense: useMutation({
      mutationFn: deleteExpense,
      onMutate: async (id: string) => {
        await queryClient.cancelQueries({ queryKey: queryKeys.expenses });
        const prev = queryClient.getQueryData<Expense[]>(queryKeys.expenses);
        queryClient.setQueryData(queryKeys.expenses, (cur: Expense[] | undefined) => cur?.filter((e) => e.id !== id) ?? []);
        return { prev };
      },
      onError: (_err, _id, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKeys.expenses, ctx.prev); },
      onSettled: invalidate
    })
  };
}

export function useReceiptVouchers(year: number, enabled = true) {
  return useQuery<ReceiptVoucher[]>({
    queryKey: queryKeys.receiptVouchers(year),
    queryFn: async () => {
      if (isSupabaseConfigured() && isOnline()) {
        return fetchFirmReceiptVouchers(year);
      }
      return [];
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}
