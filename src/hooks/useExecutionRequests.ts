import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createExecutionRequest,
  deleteExecutionRequest,
  fetchExecutionRequests,
  updateExecutionRequest,
  type ExecutionRequestInput
} from '../lib/executionRequests';

export const executionRequestsQueryKey = ['execution-requests'] as const;

export function useExecutionRequests(enabled: boolean) {
  return useQuery({
    queryKey: executionRequestsQueryKey,
    queryFn: fetchExecutionRequests,
    enabled
  });
}

export function useExecutionRequestMutations() {
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (input: ExecutionRequestInput) => createExecutionRequest(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: executionRequestsQueryKey })
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ExecutionRequestInput> }) =>
      updateExecutionRequest(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: executionRequestsQueryKey })
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteExecutionRequest(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: executionRequestsQueryKey })
  });

  return { create, update, remove };
}
