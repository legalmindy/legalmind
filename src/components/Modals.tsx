import type {
  CaseRecord,
  CaseStage,
  CaseType,
  Client,
  DocumentItem,
  Employee,
  Lawyer,
  SessionItem
} from '../types/app';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RichTextEditor } from './ui/RichTextEditor';
import { fetchAssignableFirmRoles } from '../lib/permissions';
import { legacyEmployeeRoleFromFirmSlug } from '../lib/roleLabels';
import type { FirmRole } from '../types/app';

interface ClientModalProps {
  open: boolean;
  client: Client | null;
  formState: Omit<Client, 'id' | 'casesCount' | 'createdAt'>;
  onChange: (value: Omit<Client, 'id' | 'casesCount' | 'createdAt'>) => void;
  onSave: () => void;
  onClose: () => void;
}

interface CaseModalProps {
  open: boolean;
  caseRecord: CaseRecord | null;
  formState: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted'>;
  clients: Client[];
  lawyers: Lawyer[];
  onChange: (value: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted'>) => void;
  onSave: () => void;
  onClose: () => void;
}

interface SessionModalProps {
  open: boolean;
  session: SessionItem | null;
  formState: Omit<SessionItem, 'id' | 'caseTitle'>;
  cases: CaseRecord[];
  onChange: (value: Omit<SessionItem, 'id' | 'caseTitle'>) => void;
  onSave: () => void;
  onClose: () => void;
}

interface DocumentModalProps {
  open: boolean;
  formState: Pick<DocumentItem, 'title' | 'caseId' | 'category'>;
  cases: CaseRecord[];
  onChange: (value: DocumentModalProps['formState']) => void;
  onSave: () => void;
  onClose: () => void;
  onFileSelect?: (file: File | null) => void;
  selectedFile?: File | null;
}

interface EmployeeModalProps {
  open: boolean;
  employee: Employee | null;
  formState: Omit<Employee, 'id' | 'created_at'>;
  onChange: (value: Omit<Employee, 'id' | 'created_at'>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ModalShell({
  title,
  children,
  footer,
  onClose,
  wide = false
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className={`flex w-full max-h-[92vh] flex-col rounded-t-2xl bg-white text-right shadow-2xl sm:max-h-[90vh] sm:rounded-2xl ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
          <h3 id="modal-title" className="text-base font-extrabold text-slate-800">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {children}
        </div>

        {footer ? (
          <div className="flex shrink-0 justify-end gap-2.5 border-t border-slate-100 bg-white px-5 py-4 sm:rounded-b-2xl sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModalFooter({
  onClose,
  onSave,
  cancelLabel,
  saveLabel,
  saving = false,
  disabled = false
}: {
  onClose: () => void;
  onSave: () => void;
  cancelLabel: string;
  saveLabel: string;
  saving?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || saving;
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={isDisabled}
        className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saveLabel}
      </button>
    </>
  );
}

export function ClientModal({ open, client, formState, onChange, onSave, onClose }: ClientModalProps) {
  if (!open) return null;

  return (
    <ModalShell
      title={client ? 'تعديل بيانات الموكل' : 'تسجيل موكل جديد'}
      onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={onSave} cancelLabel="إلغاء الأمر" saveLabel="حفظ العميل" />}
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">اسم الموكل</label>
          <input
            type="text"
            value={formState.name}
            onChange={(e) => onChange({ ...formState, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="الاسم الثلاثي أو الرباعي"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">رقم الهاتف اليمني</label>
            <input
              type="text"
              value={formState.phone}
              onChange={(e) => onChange({ ...formState, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
              placeholder="770000000"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">نوع الكيان</label>
            <select
              value={formState.type}
              onChange={(e) => onChange({ ...formState, type: e.target.value as Client['type'] })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="فرد">فرد</option>
              <option value="شركة تجارية">شركة تجارية</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">العنوان ومحل الإقامة</label>
          <input
            type="text"
            value={formState.address}
            onChange={(e) => onChange({ ...formState, address: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="المحافظة - المديرية - الشارع"
          />
        </div>
      </div>
    </ModalShell>
  );
}

export function CaseModal({ open, caseRecord, formState, clients, lawyers, onChange, onSave, onClose }: CaseModalProps) {
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});

  if (!open) return null;

  const validate = (): boolean => {
    const next: Partial<Record<string, string>> = {};
    if (!formState.title.trim())   next.title    = 'موضوع القضية مطلوب';
    if (!formState.clientId)       next.clientId = 'يجب اختيار الموكل';
    if (!formState.court.trim())   next.court    = 'اسم المحكمة مطلوب';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (validate()) onSave();
  };

  const fieldCls = (key: string) =>
    `w-full px-3 py-2 rounded-lg border outline-none text-right text-xs transition-colors ${
      errors[key]
        ? 'border-rose-400 bg-rose-50 focus:border-rose-500'
        : 'border-slate-200 focus:border-indigo-400'
    }`;

  const selectCls = (key: string) =>
    `w-full px-3 py-2 rounded-lg border outline-none bg-white text-right text-xs transition-colors ${
      errors[key]
        ? 'border-rose-400 bg-rose-50'
        : 'border-slate-200'
    }`;

  const ErrMsg = ({ field }: { field: string }) =>
    errors[field] ? (
      <p className="mt-1 text-[11px] text-rose-600 font-medium flex items-center gap-1">
        <span>⚠</span> {errors[field]}
      </p>
    ) : null;

  return (
    <ModalShell
      title={caseRecord ? 'تعديل ملف القضية' : 'فتح ملف قضية جديد'}
      onClose={onClose}
      wide
      footer={
        <ModalFooter
          onClose={onClose}
          onSave={handleSave}
          cancelLabel="إلغاء الأمر"
          saveLabel="حفظ ملف القضية"
        />
      }
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">
            موضوع القضية الرئيسي <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={formState.title}
            onChange={(e) => { onChange({ ...formState, title: e.target.value }); setErrors((p) => ({ ...p, title: '' })); }}
            className={fieldCls('title')}
            placeholder="عنوان القضية في سجلات المحكمة"
          />
          <ErrMsg field="title" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">
              الموكل <span className="text-rose-500">*</span>
            </label>
            <select
              value={formState.clientId}
              onChange={(e) => { onChange({ ...formState, clientId: e.target.value }); setErrors((p) => ({ ...p, clientId: '' })); }}
              className={selectCls('clientId')}
            >
              <option value="">اختر العميل الموكل...</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            <ErrMsg field="clientId" />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">تصنيف الدعوى</label>
            <select
              value={formState.category}
              onChange={(e) => onChange({ ...formState, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right text-xs"
            >
              <option value="تجاري">تجاري</option>
              <option value="مدني">مدني</option>
              <option value="عقاري">عقاري</option>
              <option value="عمالي">عمالي</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">
              المحكمة المختصة <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formState.court}
              onChange={(e) => { onChange({ ...formState, court: e.target.value }); setErrors((p) => ({ ...p, court: '' })); }}
              className={fieldCls('court')}
              placeholder="اسم المحكمة والدائرة"
            />
            <ErrMsg field="court" />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">رقم القضية في المحكمة</label>
            <input
              type="text"
              value={formState.caseNo}
              onChange={(e) => onChange({ ...formState, caseNo: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right text-xs font-mono"
              placeholder="مثال: ١٤٥/ب/٢٠٢٦"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">المحامي المباشر</label>
          <select
            value={formState.lawyerId}
            onChange={(e) => onChange({ ...formState, lawyerId: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right text-xs"
          >
            <option value="">اختر المحامي المسؤول...</option>
            {lawyers.map((lawyer) => (
              <option key={lawyer.id} value={lawyer.id}>{lawyer.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">نوع القضية</label>
            <select
              value={formState.case_type || formState.category}
              onChange={(e) => onChange({ ...formState, case_type: e.target.value as CaseType, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="مدنية">مدنية</option>
              <option value="تجارية">تجارية</option>
              <option value="أحوال شخصية">أحوال شخصية</option>
              <option value="عمالية">عمالية</option>
              <option value="مستعجلة">مستعجلة</option>
              <option value="جنائية">جنائية</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">مرحلة القضية</label>
            <select
              value={formState.case_stage}
              onChange={(e) => onChange({ ...formState, case_stage: e.target.value as CaseStage })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="ابتدائي مدني">ابتدائي مدني</option>
              <option value="ابتدائي شخصي">ابتدائي شخصي</option>
              <option value="ابتدائي جنائي">ابتدائي جنائي</option>
              <option value="استئناف">استئناف</option>
              <option value="نقض">نقض</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">إجمالي المبلغ</label>
            <input
              type="number"
              value={formState.total_amount ?? ''}
              onChange={(e) => onChange({ ...formState, total_amount: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">المبلغ المدفوع</label>
            <input
              type="number"
              value={formState.paid_amount ?? ''}
              onChange={(e) => onChange({ ...formState, paid_amount: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">المتبقي</label>
            <input
              type="text"
              readOnly
              value={((formState.total_amount || 0) - (formState.paid_amount || 0)).toFixed(2)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-right"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">حالة القضية</label>
            <select
              value={formState.status}
              onChange={(e) => onChange({ ...formState, status: e.target.value as import('../types/app').CaseStatus })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="active">نشط</option>
              <option value="archived">مؤرشف</option>
              <option value="closed">مغلق</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">ملخص القضية والادعاءات</label>
          <textarea
            value={formState.description}
            onChange={(e) => onChange({ ...formState, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="اكتب تفاصيل وملخص الخصومة وطلبات الموكل..."
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">ملاحظات إضافية</label>
          <textarea
            value={formState.notes || ''}
            onChange={(e) => onChange({ ...formState, notes: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="سجل ملاحظات داخلية، أو بيانات أرشيفية إضافية..."
          />
        </div>
      </div>
    </ModalShell>
  );
}

export function SessionModal({ open, session, formState, cases, onChange, onSave, onClose }: SessionModalProps) {
  if (!open) return null;

  return (
    <ModalShell
      title={session ? 'تحديث الجلسة' : 'جدولة جلسة جديدة'}
      onClose={onClose}
      footer={
        <ModalFooter
          onClose={onClose}
          onSave={onSave}
          cancelLabel="إلغاء الموعد"
          saveLabel="جدولة الجلسة"
        />
      }
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">الملف القضائي</label>
          <select
            value={formState.caseId}
            onChange={(e) => onChange({ ...formState, caseId: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
          >
            <option value="">اختر القضية المعنية...</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">المحكمة ومقر انعقاد الدائرة</label>
          <input
            type="text"
            value={formState.court}
            onChange={(e) => onChange({ ...formState, court: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="مثال: محكمة استئناف الأمانة - الشعبة التجارية الثالثة"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">تاريخ الجلسة</label>
            <input
              type="date"
              value={formState.date}
              onChange={(e) => onChange({ ...formState, date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">الوقت</label>
            <input
              type="time"
              value={formState.time}
              onChange={(e) => onChange({ ...formState, time: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">نوع وموضوع الجلسة</label>
          <input
            type="text"
            value={formState.type}
            onChange={(e) => onChange({ ...formState, type: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="مثال: تقديم مذكرات الرد والدفوع"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">ملاحظات وطلبات القضاة</label>
          <input
            type="text"
            value={formState.notes}
            onChange={(e) => onChange({ ...formState, notes: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="المستندات أو الحضور الشخصي المطلوب"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">اسم القاضي</label>
          <input
            type="text"
            value={formState.judgeName ?? ''}
            onChange={(e) => onChange({ ...formState, judgeName: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="اسم القاضي / الدائرة"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">تاريخ الجلسة القادمة</label>
          <input
            type="date"
            value={formState.nextSessionDate ?? ''}
            onChange={(e) => onChange({ ...formState, nextSessionDate: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">ما حدث في الجلسة</label>
          <RichTextEditor
            value={formState.sessionOutcome ?? ''}
            onChange={(html) => onChange({ ...formState, sessionOutcome: html })}
            placeholder="الوقائع، القرارات، الطلبات، نتائج المحكمة، ملاحظات المحامي..."
            minHeight="160px"
          />
        </div>
      </div>
    </ModalShell>
  );
}

export function DocumentModal({ open, formState, cases, onChange, onSave, onClose, onFileSelect, selectedFile }: DocumentModalProps) {
  if (!open) return null;

  return (
    <ModalShell
      title="رفع مستند قانوني آمن"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            إلغاء الأمر
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
          >
            رفع المستند
          </button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">ربط المستند بالقضية <span className="text-rose-500">*</span></label>
          <select
            value={formState.caseId}
            onChange={(e) => onChange({ ...formState, caseId: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
          >
            <option value="">حدد القضية المرتبطة...</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">اسم المستند</label>
          <input
            type="text"
            value={formState.title}
            onChange={(e) => onChange({ ...formState, title: e.target.value })}
            placeholder="مثال: عريضة الدعوى الأولية — يترك فارغاً لاستخدام اسم الملف"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right text-xs"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">نوع المستند <span className="text-rose-500">*</span></label>
          <select
            value={formState.category}
            onChange={(e) => onChange({ ...formState, category: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
          >
            <option value="عريضة دعوى">عريضة دعوى</option>
            <option value="مذكرة دفاع">مذكرة دفاع</option>
            <option value="أدلة إثبات">أدلة إثبات</option>
            <option value="توكيلات رسمية">توكيلات رسمية</option>
            <option value="حكم قضائي">حكم قضائي</option>
            <option value="تقارير فنية">تقارير فنية</option>
            <option value="عقد أو اتفاقية">عقد أو اتفاقية</option>
            <option value="شهادة أو إفادة">شهادة أو إفادة</option>
            <option value="مراسلات رسمية">مراسلات رسمية</option>
            <option value="صورة أو إثبات">صورة أو إثبات</option>
            <option value="مستند قانوني">مستند قانوني (عام)</option>
          </select>
        </div>

        <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2 hover:bg-slate-50 transition-colors">
          <label className="cursor-pointer block">
            <span className="block text-xs font-bold text-slate-600">اضغط هنا لاختيار الملف</span>
            <span className="block text-[10px] text-slate-400">PDF, DOCX, XLSX, JPG, PNG, WEBP — حتى 50 ميجابايت</span>
            <input
              type="file"
              accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp"
              className="sr-only"
              onChange={(e) => onFileSelect?.(e.target.files?.[0] ?? null)}
            />
          </label>
          {selectedFile && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-xs text-emerald-700 font-bold">{selectedFile.name}</span>
              <span className="text-[10px] text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

export function EmployeeModal({ open, employee, formState, onChange, onSave, onClose }: EmployeeModalProps) {
  const [assignableRoles, setAssignableRoles] = useState<FirmRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState('');

  useEffect(() => {
    if (!open) return;

    setRolesLoading(true);
    setRolesError('');
    void fetchAssignableFirmRoles()
      .then((roles) => {
        setAssignableRoles(roles);
        if (!roles.length) return;

        const currentRoleId = formState.firm_role_id;
        const matchedCurrent = currentRoleId ? roles.find((role) => role.id === currentRoleId) : undefined;
        const fallbackRole =
          matchedCurrent ??
          roles.find((role) => role.slug === employee?.firmRoleSlug) ??
          roles.find((role) => role.slug === 'lawyer') ??
          roles[0];

        if (!fallbackRole) return;

        if (!matchedCurrent || matchedCurrent.id !== fallbackRole.id) {
          onChange({
            ...formState,
            firm_role_id: fallbackRole.id,
            role: legacyEmployeeRoleFromFirmSlug(fallbackRole.slug)
          });
        }
      })
      .catch(() => setRolesError('تعذر تحميل أدوار المكتب. حدّث الصفحة وحاول مرة أخرى.'))
      .finally(() => setRolesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync default role once when modal opens
  }, [open, employee?.id]);

  if (!open) return null;

  const handleRoleChange = (roleId: string) => {
    const selectedRole = assignableRoles.find((role) => role.id === roleId);
    if (!selectedRole) return;
    onChange({
      ...formState,
      firm_role_id: selectedRole.id,
      role: legacyEmployeeRoleFromFirmSlug(selectedRole.slug)
    });
  };

  return (
    <ModalShell
      title={employee ? 'تعديل عضو الفريق' : 'دعوة عضو جديد للمكتب'}
      onClose={onClose}
      footer={
        <ModalFooter
          onClose={onClose}
          onSave={onSave}
          cancelLabel="إلغاء الأمر"
          saveLabel={employee ? 'حفظ التعديلات' : 'إرسال الدعوة'}
        />
      }
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">الاسم الكامل</label>
          <input
            type="text"
            value={formState.full_name}
            onChange={(e) => onChange({ ...formState, full_name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="اسم المحامي أو المساعد"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">البريد الإلكتروني</label>
            <input
              type="email"
              value={formState.email}
              disabled={Boolean(employee)}
              onChange={(e) => onChange({ ...formState, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right disabled:bg-slate-50"
              placeholder="name@example.com"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">رقم الهاتف</label>
            <input
              type="text"
              value={formState.phone}
              onChange={(e) => onChange({ ...formState, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
              placeholder="770000000"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">الدور</label>
            <select
              value={formState.firm_role_id ?? ''}
              onChange={(e) => handleRoleChange(e.target.value)}
              disabled={rolesLoading || assignableRoles.length === 0}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right disabled:bg-slate-50"
            >
              {rolesLoading ? <option value="">جاري تحميل الأدوار...</option> : null}
              {!rolesLoading && assignableRoles.length === 0 ? <option value="">لا توجد أدوار متاحة</option> : null}
              {assignableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            {rolesError ? <p className="mt-1 text-[11px] font-bold text-rose-600">{rolesError}</p> : null}
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">الحالة</label>
            <select
              value={formState.status}
              onChange={(e) => onChange({ ...formState, status: e.target.value as Employee['status'] })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="active">نشط</option>
              <option value="suspended">معلق</option>
              <option value="disabled">معطل</option>
            </select>
          </div>
        </div>

        {!employee && (
          <p className="bg-indigo-50 text-indigo-800 border border-indigo-100 rounded-xl p-3 leading-relaxed">
            سيتم إنشاء رابط دعوة آمن. <strong>لن يُرسل بريد تلقائياً</strong> — بعد الحفظ انسخ الرابط أو أرسله للمدعو عبر واتساب أو أي وسيلة.
          </p>
        )}
      </div>
    </ModalShell>
  );
}

interface ArchiveCaseModalProps {
  open: boolean;
  caseRecord: CaseRecord | null;
  notes: string;
  onNotesChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ArchiveCaseModal({ open, caseRecord, notes, onNotesChange, onConfirm, onClose }: ArchiveCaseModalProps) {
  if (!open || !caseRecord) return null;

  return (
    <ModalShell
      title="أرشفة ملف القضية"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-amber-700"
          >
            تأكيد الأرشفة
          </button>
        </>
      }
    >
      <div className="space-y-4 text-xs text-right">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">{caseRecord.title}</p>
          <p className="mt-1 text-slate-600">رقم القضية: {caseRecord.caseNo || caseRecord.court_case_number}</p>
        </div>
        <p className="text-slate-600 leading-relaxed">
          سيتم نقل القضية إلى الأرشيف. أضف ملاحظات الأرشفة (سبب الإغلاق، نتيجة الحكم، أو أي تفاصيل مهمة).
        </p>
        <div>
          <label className="mb-1 block font-bold text-slate-600">ملاحظات الأرشيف</label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-right outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            placeholder="مثال: انتهت القضية بصلح، أو صدر حكم نهائي، أو طلب الموكل إغلاق الملف..."
          />
        </div>
      </div>
    </ModalShell>
  );
}
