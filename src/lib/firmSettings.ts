import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import type { Office } from '../types/app';

export interface FirmSettingsPayload {
  remindersEnabled: boolean;
  whatsappReportsEnabled: boolean;
  smsReportsEnabled: boolean;
  hideFinancialsFromTrainees: boolean;
}

export async function fetchFirmSettings(): Promise<FirmSettingsPayload & { office: Office }> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('firms')
    .select(
      'id, name, license_no, plan, firm_code, subscription_status, subscription_plan, subscription_expires_at, is_locked, reminders_enabled, whatsapp_reports_enabled, sms_reports_enabled, hide_financials_from_trainees'
    )
    .eq('id', firmId)
    .single();

  if (error) throw error;

  const row = data as Record<string, unknown>;
  const office: Office = {
    id: row.id as string,
    name: row.name as string,
    licenseNo: (row.license_no as string) ?? '',
    plan: (row.plan as string) ?? 'free',
    firmCode: (row.firm_code as string) ?? undefined,
    subscriptionStatus: row.subscription_status as Office['subscriptionStatus'],
    subscriptionPlan: row.subscription_plan as Office['subscriptionPlan'],
    subscriptionExpiresAt: (row.subscription_expires_at as string) ?? null,
    isLocked: Boolean(row.is_locked),
    remindersEnabled: row.reminders_enabled !== false,
    whatsappReportsEnabled: row.whatsapp_reports_enabled !== false,
    smsReportsEnabled: Boolean(row.sms_reports_enabled),
    hideFinancialsFromTrainees: row.hide_financials_from_trainees !== false
  };

  return {
    office,
    remindersEnabled: office.remindersEnabled ?? true,
    whatsappReportsEnabled: office.whatsappReportsEnabled ?? true,
    smsReportsEnabled: office.smsReportsEnabled ?? false,
    hideFinancialsFromTrainees: office.hideFinancialsFromTrainees ?? true
  };
}

export async function updateFirmSettings(payload: FirmSettingsPayload): Promise<void> {
  const firmId = await getCurrentFirmId();
  const { error } = await supabase
    .from('firms')
    .update({
      reminders_enabled: payload.remindersEnabled,
      whatsapp_reports_enabled: payload.whatsappReportsEnabled,
      sms_reports_enabled: payload.smsReportsEnabled,
      hide_financials_from_trainees: payload.hideFinancialsFromTrainees
    })
    .eq('id', firmId);

  if (error) throw error;
}
