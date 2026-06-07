import type {
  CaseRecord,
  Client,
  DocumentItem,
  Lawyer,
  SessionItem
} from '../types/app';
import type { ReactNode } from 'react';

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
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-right animate-scaleUp">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h3 className="font-extrabold text-base text-slate-800 font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-50 rounded-lg">
            <span className="sr-only">إغلاق</span>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ClientModal({ open, client, formState, onChange, onSave, onClose }: ClientModalProps) {
  if (!open) return null;

  return (
    <ModalShell title={client ? 'تعديل بيانات الموكل' : 'تسجيل موكل جديد'} onClose={onClose}>
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

      <div className="border-t border-slate-100 pt-4 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-500 hover:bg-slate-50">
          إلغاء الأمر
        </button>
        <button type="button" onClick={onSave} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs">
          حفظ العميل
        </button>
      </div>
    </ModalShell>
  );
}

export function CaseModal({ open, caseRecord, formState, clients, lawyers, onChange, onSave, onClose }: CaseModalProps) {
  if (!open) return null;

  return (
    <ModalShell title={caseRecord ? 'تعديل ملف القضية' : 'فتح ملف قضية جديد'} onClose={onClose}>
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">موضوع القضية الرئيسي</label>
          <input
            type="text"
            value={formState.title}
            onChange={(e) => onChange({ ...formState, title: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="عنوان القضية في سجلات المحكمة"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-600 mb-1 font-bold">الموكل</label>
            <select
              value={formState.clientId}
              onChange={(e) => onChange({ ...formState, clientId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
            >
              <option value="">اختر العميل الموكل...</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">تصنيف الدعوى</label>
            <select
              value={formState.category}
              onChange={(e) => onChange({ ...formState, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
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
            <label className="block text-slate-600 mb-1 font-bold">المحكمة المختصة</label>
            <input
              type="text"
              value={formState.court}
              onChange={(e) => onChange({ ...formState, court: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
              placeholder="اسم المحكمة والدائرة"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 font-bold">رقم القضية في المحكمة</label>
            <input
              type="text"
              value={formState.caseNo}
              onChange={(e) => onChange({ ...formState, caseNo: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right font-mono"
              placeholder="مثال: ١٤٥/ب/٢٠٢٦"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">المحامي المباشر</label>
          <select
            value={formState.lawyerId}
            onChange={(e) => onChange({ ...formState, lawyerId: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
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
              onChange={(e) => onChange({ ...formState, case_type: e.target.value as any, category: e.target.value })}
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
              onChange={(e) => onChange({ ...formState, case_stage: e.target.value as any })}
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
              onChange={(e) => onChange({ ...formState, status: e.target.value })}
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

      <div className="border-t border-slate-100 pt-4 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-500 hover:bg-slate-50">
          إلغاء الأمر
        </button>
        <button type="button" onClick={onSave} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs">
          حفظ ملف القضية
        </button>
      </div>
    </ModalShell>
  );
}

export function SessionModal({ open, session, formState, cases, onChange, onSave, onClose }: SessionModalProps) {
  if (!open) return null;

  return (
    <ModalShell title={session ? 'تحديث الجلسة' : 'جدولة جلسة جديدة'} onClose={onClose}>
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
      </div>

      <div className="border-t border-slate-100 pt-4 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-500 hover:bg-slate-50">
          إلغاء الموعد
        </button>
        <button type="button" onClick={onSave} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs">
          جدولة الجلسة
        </button>
      </div>
    </ModalShell>
  );
}

export function DocumentModal({ open, formState, cases, onChange, onSave, onClose }: DocumentModalProps) {
  if (!open) return null;

  return (
    <ModalShell title="رفع مستند قانوني آمن" onClose={onClose}>
      <div className="space-y-3 text-xs">
        <div>
          <label className="block text-slate-600 mb-1 font-bold">اسم المستند</label>
          <input
            type="text"
            value={formState.title}
            onChange={(e) => onChange({ ...formState, title: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none text-right"
            placeholder="مثال: عريضة استئناف حكم"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">ربط المستند بالقضية</label>
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
          <label className="block text-slate-600 mb-1 font-bold">تصنيف المستند</label>
          <select
            value={formState.category}
            onChange={(e) => onChange({ ...formState, category: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white text-right"
          >
            <option value="عريضة دعوى">عريضة دعوى</option>
            <option value="أدلة إثبات">أدلة إثبات</option>
            <option value="توكيلات رسمية">توكيلات رسمية</option>
            <option value="تقارير فنية">تقارير فنية</option>
          </select>
        </div>

        <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2 cursor-pointer hover:bg-slate-50 transition-colors">
          <span className="block text-xs font-bold text-slate-600">اضغط هنا أو اسحب الملف للرفع الفوري</span>
          <span className="block text-[10px] text-slate-400">PDF, DOCX, PNG حتى 20 ميجابايت</span>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-500 hover:bg-slate-50">
          إلغاء الأمر
        </button>
        <button type="button" onClick={onSave} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs">
          رفع المستند
        </button>
      </div>
    </ModalShell>
  );
}
