import React, { useState } from 'react';
import { X, Loader, AlertTriangle } from 'lucide-react';
import { supabase } from './supabaseClient.tsx';
import { Client, CaseRecord } from './types/app.ts';

interface AddCaseFormProps {
  isOpen: boolean;
  onClose: () => void;
  onCaseAdded: (caseRecord: CaseRecord) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  clients: Client[];
}

const CATEGORIES = ['تجاري', 'مدني', 'عقاري', 'جنائي', 'عمالي', 'أسري', 'إداري'];
const STATUSES   = ['نشط', 'تحت الدراسة', 'مغلق', 'مرفوع استئناف'];

const EMPTY_FORM = {
  title: '', clientId: '', category: 'تجاري',
  status: 'نشط', court: '', caseNo: '',
  lawyerId: '', description: '',
};

export default function AddCaseForm({
  isOpen, onClose, onCaseAdded, onError, onSuccess, clients,
}: AddCaseFormProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: string[] = [];
    if (!form.title.trim())    errs.push('عنوان القضية مطلوب.');
    if (!form.clientId)        errs.push('يجب اختيار عميل.');
    if (!form.court.trim())    errs.push('اسم المحكمة مطلوب.');
    if (!form.caseNo.trim())   errs.push('رقم القضية مطلوب.');
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    setErrors([]);

    const clientName = clients.find(c => c.id === form.clientId)?.name ?? '';

    const { data, error } = await supabase
      .from('cases')
      .insert({
        title:       form.title.trim(),
        clientId:    form.clientId,
        clientName,
        category:    form.category,
        status:      form.status,
        court:       form.court.trim(),
        caseNo:      form.caseNo.trim(),
        lawyerId:    form.lawyerId.trim() || null,
        description: form.description.trim(),
        dateStarted: new Date().toISOString(),
      })
      .select()
      .single();

    setSubmitting(false);

    if (error) { onError('حدث خطأ أثناء الحفظ: ' + error.message); return; }

    onCaseAdded(data as CaseRecord);
    onSuccess('تم إضافة القضية بنجاح!');
    setForm(EMPTY_FORM);
    onClose();
  };

  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">فتح ملف قضية جديد</h2>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}

          {clients.length === 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              <AlertTriangle size={16} />
              <span>لا يوجد عملاء. أضف عميلاً أولاً قبل فتح قضية.</span>
            </div>
          )}

          {field('title', 'عنوان القضية', 'نزاع تجاري حول عقد شراء')}

          {/* Client dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">العميل</label>
            <select
              value={form.clientId}
              onChange={e => setForm(prev => ({ ...prev, clientId: e.target.value }))}
              disabled={submitting || clients.length === 0}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            >
              <option value="">-- اختر عميلاً --</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Category & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">الفئة</label>
              <select
                value={form.category}
                onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
                disabled={submitting}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">الحالة</label>
              <select
                value={form.status}
                onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}
                disabled={submitting}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field('court',  'المحكمة',    'محكمة استئناف الأمانة')}
            {field('caseNo', 'رقم القضية', '145/ب/2026')}
          </div>

          {field('lawyerId',    'معرّف المحامي (اختياري)', 'LAW-001')}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">وصف القضية (اختياري)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="تفاصيل إضافية عن القضية..."
              disabled={submitting}
              rows={3}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-slate-100 shrink-0">
          <button
            onClick={handleSubmit}
            disabled={submitting || clients.length === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-60"
          >
            {submitting ? <><Loader size={16} className="animate-spin" /> جاري الحفظ...</> : 'حفظ القضية'}
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
