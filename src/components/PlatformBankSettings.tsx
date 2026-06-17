import { useEffect, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { usePlatformBankDetails, usePlatformBankMutations } from '../hooks/usePlatformBank';
import type { PlatformBankDetails } from '../types/app';

interface PlatformBankSettingsProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export function PlatformBankSettings({ onNotify }: PlatformBankSettingsProps) {
  const { data, isLoading } = usePlatformBankDetails(true);
  const save = usePlatformBankMutations();
  const [form, setForm] = useState<PlatformBankDetails>({
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    note: ''
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = async () => {
    try {
      await save.mutateAsync(form);
      onNotify('تم حفظ بيانات الحساب البنكي.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل حفظ بيانات البنك.', 'error');
    }
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-indigo-700" />
        <h3 className="font-black text-slate-900 text-sm">بيانات الحساب البنكي للاشتراكات</h3>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        تظهر هذه البيانات للمكاتب عند طلب تجديد الاشتراك حتى يعرفوا أين يحوّلون المبلغ.
      </p>
      {isLoading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">اسم البنك</label>
            <input
              type="text"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-right"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">اسم الحساب</label>
            <input
              type="text"
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-right"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">رقم الحساب</label>
            <input
              type="text"
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-right font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">IBAN</label>
            <input
              type="text"
              value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-right font-mono"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-slate-600 mb-1 font-bold">ملاحظة للعملاء</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-right resize-none"
            />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={save.isPending || isLoading}
        className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl text-xs"
      >
        {save.isPending ? 'جاري الحفظ...' : 'حفظ بيانات البنك'}
      </button>
    </div>
  );
}
