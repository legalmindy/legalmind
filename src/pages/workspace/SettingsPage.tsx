import { useEffect, useState } from 'react';
import { MfaSettings } from '../../components/MfaSettings';
import { FirmCodeCard } from '../../components/FirmCodeCard';
import { PlatformBankSettings } from '../../components/PlatformBankSettings';
import { SecurityEventsPanel } from '../../components/SecurityEventsPanel';
import { SettingsToggleRow } from '../../components/SettingsToggleRow';
import { useFirmProfile } from '../../hooks/useSupabaseQueries';
import { useFirmSettings, useFirmSettingsMutations } from '../../hooks/useFirmSettings';
import type { Office } from '../../types/app';
import type { SettingsPageProps } from './types';
export function SettingsPage({ user, office, onSaveOffice, onFirmCodeCopied }: SettingsPageProps) {
  const isAdmin = user.role === 'admin' || user.role === 'firm_manager' || user.role === 'super_admin';
  const { data: firmProfile } = useFirmProfile(isAdmin);
  const { data: firmSettings, isLoading: settingsLoading } = useFirmSettings(isAdmin);
  const { updateSettings } = useFirmSettingsMutations();
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? user.company;

  const [officeForm, setOfficeForm] = useState<Office>({
    id: '',
    name: user.company,
    licenseNo: user.licenseNo,
    plan: user.plan
  });

  const [settingsForm, setSettingsForm] = useState({
    remindersEnabled: true,
    whatsappReportsEnabled: true,
    smsReportsEnabled: false,
    hideFinancialsFromTrainees: true
  });

  useEffect(() => {
    if (office) setOfficeForm(office);
  }, [office]);

  useEffect(() => {
    if (firmSettings) {
      setSettingsForm({
        remindersEnabled: firmSettings.remindersEnabled,
        whatsappReportsEnabled: firmSettings.whatsappReportsEnabled,
        smsReportsEnabled: firmSettings.smsReportsEnabled,
        hideFinancialsFromTrainees: firmSettings.hideFinancialsFromTrainees
      });
    } else if (office) {
      setSettingsForm({
        remindersEnabled: office.remindersEnabled ?? true,
        whatsappReportsEnabled: office.whatsappReportsEnabled ?? true,
        smsReportsEnabled: office.smsReportsEnabled ?? false,
        hideFinancialsFromTrainees: office.hideFinancialsFromTrainees ?? true
      });
    }
  }, [firmSettings, office]);

  const saveSettings = () => {
    void updateSettings.mutateAsync(settingsForm).then(() => onFirmCodeCopied?.('تم حفظ إعدادات النظام.')).catch((err) => onFirmCodeCopied?.(err instanceof Error ? err.message : 'فشل حفظ الإعدادات.'));
  };

  return (
    <div className="max-w-3xl mx-auto mt-6 px-4 space-y-6 text-right">
      {isAdmin && firmCode ? (
        <FirmCodeCard firmCode={firmCode} firmName={firmName} onCopied={onFirmCodeCopied} />
      ) : null}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
        <h2 className="text-xl font-black text-slate-900">إعدادات النظام والمكتب القانوني</h2>
        <p className="text-xs text-slate-500">المكتب: {user.company} — الخطة: {user.plan}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1 font-bold">اسم المكتب / مساحة العمل</label>
            <input
              type="text"
              value={officeForm.name}
              onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1 font-bold">رقم ترخيص المكتب</label>
            <input
              type="text"
              value={officeForm.licenseNo}
              onChange={(e) => setOfficeForm({ ...officeForm, licenseNo: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right"
            />
          </div>
        </div>
        <button type="button" onClick={() => onSaveOffice(officeForm)} disabled={!officeForm.id} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs">
          حفظ بيانات المكتب
        </button>
        <div className="p-4 bg-slate-50 rounded-xl">
          <MfaSettings />
        </div>
        {isAdmin ? (
          <div className="rounded-xl border border-slate-100 px-4 bg-white">
            <h3 className="font-black text-slate-900 text-sm pt-4 pb-2">إعدادات الإشعارات والتقارير</h3>
            {settingsLoading ? (
              <p className="text-xs text-slate-400 py-4">جاري تحميل الإعدادات...</p>
            ) : (
              <>
                <SettingsToggleRow
                  title="التذكيرات الذكية"
                  description="عرض تنبيه بالجلسات المجدولة اليوم وغداً في لوحة التحكم، وإرسال إشعار داخلي عند إنشاء جلسة جديدة."
                  checked={settingsForm.remindersEnabled}
                  onChange={(remindersEnabled) => setSettingsForm((s) => ({ ...s, remindersEnabled }))}
                />
                <SettingsToggleRow
                  title="إرسال التقارير للعملاء عبر WhatsApp"
                  description="السماح بإرسال تقارير مختصرة للموكلين عبر واتساب."
                  checked={settingsForm.whatsappReportsEnabled}
                  onChange={(whatsappReportsEnabled) => setSettingsForm((s) => ({ ...s, whatsappReportsEnabled }))}
                />
                <SettingsToggleRow
                  title="إرسال التقارير للعملاء عبر رسائل SMS"
                  description="السماح بإرسال تقارير مختصرة للموكلين عبر رسائل نصية."
                  checked={settingsForm.smsReportsEnabled}
                  onChange={(smsReportsEnabled) => setSettingsForm((s) => ({ ...s, smsReportsEnabled }))}
                />
                <SettingsToggleRow
                  title="حظر رؤية المتدربين للمبالغ المالية"
                  description="تأمين حجب المذكرات المالية عن حسابات المتدربين."
                  checked={settingsForm.hideFinancialsFromTrainees}
                  onChange={(hideFinancialsFromTrainees) => setSettingsForm((s) => ({ ...s, hideFinancialsFromTrainees }))}
                />
              </>
            )}
          </div>
        ) : null}
        {isAdmin ? (
          <button type="button" onClick={saveSettings} disabled={updateSettings.isPending || settingsLoading} className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-xs">
            {updateSettings.isPending ? 'جاري الحفظ...' : 'تحديث إعدادات الأمان'}
          </button>
        ) : null}
        {user.role === 'super_admin' ? (
          <PlatformBankSettings
            onNotify={(message) => onFirmCodeCopied?.(message)}
          />
        ) : null}
        {isAdmin ? <SecurityEventsPanel /> : null}
      </div>
    </div>
  );
}
