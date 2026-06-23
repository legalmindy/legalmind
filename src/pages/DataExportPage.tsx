import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  FileArchive,
  Filter,
  Loader2,
  Database
} from 'lucide-react';
import {
  EXPORT_ENTITY_LABELS,
  exportAllFirmData,
  exportFirmData,
  type ExportEntity,
  type ExportFormat
} from '../lib/dataExport';
import { fetchAllCases, fetchAllClients } from '../lib/api';
import { toArabicQueryError } from '../components/QueryErrorBanner';

const ALL_ENTITIES = Object.keys(EXPORT_ENTITY_LABELS) as ExportEntity[];

export function DataExportPage() {
  const [selected, setSelected] = useState<ExportEntity[]>([...ALL_ENTITIES]);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [caseId, setCaseId] = useState('');
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: clients = [] } = useQuery({ queryKey: ['export-clients'], queryFn: fetchAllClients });
  const { data: cases = [] } = useQuery({ queryKey: ['export-cases'], queryFn: fetchAllCases });

  const filters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      caseId: caseId || undefined,
      clientId: clientId || undefined
    }),
    [dateFrom, dateTo, caseId, clientId]
  );

  const toggleEntity = (entity: ExportEntity) => {
    setSelected((prev) => (prev.includes(entity) ? prev.filter((e) => e !== entity) : [...prev, entity]));
  };

  const runExport = async (all = false) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = all
        ? await exportAllFirmData(format, filters)
        : await exportFirmData(selected, format, filters);
      setMessage(`تم التصدير بنجاح — ${result.recordCount} سجل — ${result.filename}`);
    } catch (err) {
      setError(toArabicQueryError(err, 'تصدير البيانات'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6" dir="rtl">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-[#7A1F2B]/10 p-3">
            <Database className="h-7 w-7 text-[#7A1F2B]" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">تصدير البيانات</h1>
            <p className="mt-1 text-xs text-slate-500">
              جميع البيانات ملك للعميل — صدّر عملاءك وقضاياك ومدفوعاتك بصيغ Excel أو CSV أو ZIP.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-black text-slate-800">البيانات المراد تصديرها</h2>
          <div className="grid grid-cols-2 gap-2">
            {ALL_ENTITIES.map((entity) => (
              <label
                key={entity}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                  selected.includes(entity)
                    ? 'border-[#7A1F2B] bg-[#7A1F2B]/5 text-[#7A1F2B]'
                    : 'border-slate-100 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(entity)}
                  onChange={() => toggleEntity(entity)}
                  className="rounded"
                />
                {EXPORT_ENTITY_LABELS[entity]}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-800">
            <Filter className="h-4 w-4" /> التصفية
          </h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="mb-1 block font-bold text-slate-500">من تاريخ</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-500">إلى تاريخ</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block font-bold text-slate-500">قضية محددة</label>
              <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                <option value="">كل القضايا</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block font-bold text-slate-500">عميل محدد</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                <option value="">كل العملاء</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-slate-500">صيغة التصدير</label>
            <div className="flex flex-wrap gap-2">
              {(['xlsx', 'csv', 'zip'] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`rounded-xl px-4 py-2 text-xs font-bold uppercase ${
                    format === f ? 'bg-indigo-950 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => void runExport(false)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7A1F2B] px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          تصدير المحدد
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runExport(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-950 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          تصدير كل البيانات
        </button>
        {format !== 'zip' ? (
          <button
            type="button"
            disabled={busy || !selected.includes('documents')}
            onClick={() => void exportFirmData(['documents'], 'zip', filters).then((r) => setMessage(`تم — ${r.filename}`)).catch((e) => setError(toArabicQueryError(e, 'ZIP')))}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-700"
          >
            <FileArchive className="h-4 w-4" /> ZIP للملفات
          </button>
        ) : null}
      </div>

      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p> : null}
    </div>
  );
}
