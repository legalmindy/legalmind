import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchFirmSettings, updateFirmSettings, type FirmSettingsPayload } from '../lib/firmSettings';

export const firmSettingsQueryKey = ['firm-settings'] as const;

export function useFirmSettings(enabled: boolean) {
  return useQuery({
    queryKey: firmSettingsQueryKey,
    queryFn: fetchFirmSettings,
    enabled
  });
}

export function useFirmSettingsMutations() {
  const queryClient = useQueryClient();
  const updateSettings = useMutation({
    mutationFn: (payload: FirmSettingsPayload) => updateFirmSettings(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: firmSettingsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['office'] });
    }
  });
  return { updateSettings };
}
