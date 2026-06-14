import { useState } from 'react';
import { X, Loader } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { Client, CustomerType } from '../types/app';

interface AddClientFormProps {
  isOpen: boolean;
  onClose: () => void;
  onClientAdded: (client: Client) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const EMPTY_FORM = { name: '', phone: '', email: '', type: 'فرد' as CustomerType };

export default function AddClientForm({
  isOpen,
  onClose,
  onClientAdded,
  onError,
  onSuccess,
}: AddClientFormProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: string[] = [];
    if (!form.name.trim()) errs.push('اسم الموكل مطلوب.');
    if (!/^(77|73|71|70)\d{7}$/.test(form.phone))
      errs.push('رقم الهاتف يجب أن يبدأ بـ 77/73/71/70 ومكوّن من 9 أرقام.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.push('البريد الإلكتروني غير صحيح.');
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    setErrors([]);

    const { data, error } = await supabase
      .from('clients')
      .insert({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        type: form.type,
        address: '',
        casesCount: 0,
        createdAt: new Date().toISOString(),
      })
      .select()
      .single();

    setSubmitting(false);

    if (error) {
      onError('حدث خطأ أثناء الحفظ: ' + error.message);
      return;
    }

    onClientAdded(data as Client);
    onSuccess('تم إضافة الموكل بنجاح!');
    setForm(EMPTY_FORM);
    onClose();
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, type = 'text') => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        disabled={submitting}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">إضافة موكل جديد</h2>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}

          {field('name', 'اسم الموكل', 'محمد أحمد علي')}
          {field('phone', 'رقم الهاتف', '771234567')}
          {field('email', 'البريد الإلكتروني', 'example@mail.com', 'email')}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">نوع العميل</label>
            <select
              value={form.type}
              onChange={e => setForm(prev => ({ ...prev, type: e.target.value as CustomerType }))}
              disabled={submitting}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            >
              <option value="فرد">فرد</option>
              <option value="شركة تجارية">شركة تجارية</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-slate-100">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-60"
          >
            {submitting ? <><Loader size={16} className="animate-spin" /> جاري الحفظ...</> : 'حفظ الموكل'}
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 transition disabled:opacity-60"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
