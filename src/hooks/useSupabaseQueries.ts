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
  cancelInvitation,
  fetchInvitations,
  fetchOffice,
  inviteOfficeUser,
  resendInvitation
} from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { isOnline } from '../lib/syncEngine';
import type { PaginationParams } from '../types/database';
import type { Employee } from '../types/app';

export const queryKeys = {
  clients: (params?: PaginationParams) => ['clients', params] as const,
  cases: (params?: PaginationParams) => ['cases', params] as const,
  archivedCases: ['cases', 'archived'] as const,
  employees: ['employees'] as const,
  invitations: ['invitations'] as const,
  office: ['office'] as const,
  sessions: ['sessions'] as const,
  documents: ['documents'] as const,
  lawyers: ['lawyers'] as const,
  notifications: ['notifications'] as const
};

export function useClients(enabled = true, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.clients(params),
    queryFn: () => localClientRepository.list(),
    enabled,
    staleTime: 60_000
  });
}

export function useCases(enabled = true, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.cases(params),
    queryFn: () => localCaseRepository.list(),
    enabled,
    staleTime: 60_000
  });
}

export function useArchivedCases(enabled = true) {
  return useQuery({
    queryKey: queryKeys.archivedCases,
    queryFn: () => localCaseRepository.listArchived(),
    enabled,
    staleTime: 60_000
  });
}

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: () => localEmployeeRepository.list(),
    enabled,
    staleTime: 60_000
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

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => localSessionRepository.list(),
    enabled,
    staleTime: 60_000
  });
}

export function useDocuments(enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: () => localDocumentRepository.list(),
    enabled,
    staleTime: 60_000
  });
}

export function useLawyers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.lawyers,
    queryFn: () => localPeopleRepository.listLawyers(),
    enabled,
    staleTime: 60_000
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => localNotificationRepository.list(),
    enabled,
    staleTime: 30_000
  });
}

export function useClientMutations() {
  const queryClient = useQueryClient();
  return {
    addClient: useMutation({
      mutationFn: localClientRepository.create,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clients'] }); }
    }),
    updateClient: useMutation({
      mutationFn: localClientRepository.update,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clients'] }); }
    }),
    deleteClient: useMutation({
      mutationFn: localClientRepository.softDelete,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clients'] }); }
    })
  };
}

export function useCaseMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };
  return {
    addCase: useMutation({ mutationFn: localCaseRepository.create, onSuccess: invalidate }),
    updateCase: useMutation({ mutationFn: localCaseRepository.update, onSuccess: invalidate }),
    restoreCase: useMutation({ mutationFn: localCaseRepository.restore, onSuccess: invalidate }),
    deleteCase: useMutation({ mutationFn: localCaseRepository.softDelete, onSuccess: invalidate })
  };
}

export function useOfficeMutations() {
  const queryClient = useQueryClient();
  return {
    updateOffice: useMutation({
      mutationFn: localOfficeRepository.update,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.office }); }
    })
  };
}

export function useSessionMutations() {
  const queryClient = useQueryClient();
  return {
    createSession: useMutation({
      mutationFn: localSessionRepository.create,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }); }
    }),
    updateSession: useMutation({
      mutationFn: localSessionRepository.update,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }); }
    }),
    deleteSession: useMutation({
      mutationFn: localSessionRepository.softDelete,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }); }
    })
  };
}

export function useDocumentMutations() {
  const queryClient = useQueryClient();
  return {
    uploadFile: useMutation({
      mutationFn: ({ file, caseId }: { file: File; caseId: string }) => localDocumentRepository.upload(file, caseId),
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
      mutationFn: localEmployeeRepository.create,
      onSuccess: invalidatePeople
    }),
    updateEmployee: useMutation({
      mutationFn: localEmployeeRepository.update,
      onSuccess: invalidatePeople
    }),
    toggleEmployeeStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: Employee['status'] }) =>
        localEmployeeRepository.toggleStatus(id, status),
      onSuccess: invalidatePeople
    }),
    deleteEmployee: useMutation({
      mutationFn: localEmployeeRepository.softDelete,
      onSuccess: invalidatePeople
    }),
    inviteEmployee: useMutation({
      mutationFn: inviteOfficeUser,
      onSuccess: invalidatePeople
    }),
    revokeInvitation: useMutation({
      mutationFn: cancelInvitation,
      onSuccess: invalidatePeople
    }),
    resendInvitation: useMutation({
      mutationFn: resendInvitation,
      onSuccess: invalidatePeople
    })
  };
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  return {
    createNotification: useMutation({
      mutationFn: localNotificationRepository.create,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); }
    }),
    markNotificationRead: useMutation({
      mutationFn: localNotificationRepository.markRead,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); }
    }),
    markAllNotificationsRead: useMutation({
      mutationFn: localNotificationRepository.markAllRead,
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); }
    })
  };
}

export function useRealtimeNotifications(onNewNotification: () => void) {
  void onNewNotification;
}
