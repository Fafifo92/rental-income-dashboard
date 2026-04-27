'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { VendorKind, PropertyRow, VendorPropertyRow, BankAccountRow, SharedBillRow, ExpenseCategory } from '@/types/database';
import { EXPENSE_CATEGORIES } from '@/types/database';
import { listVendors, createVendor, updateVendor, deleteVendor, type Vendor } from '@/services/vendors';
import { listVendorProperties, setVendorProperties, listAllVendorProperties } from '@/services/vendorProperties';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { listSharedBills, deleteSharedBill } from '@/services/sharedBills';
import { currentYearMonth, yearMonthRange } from '@/services/recurringPeriods';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import SharedBillPayModal from './SharedBillPayModal';

const KINDS: { value: VendorKind; label: string; icon: string }[] = [
  { value: 'utility',     label: 'Servicio público',   icon: '💡' },
  { value: 'admin',       label: 'Administración',     icon: '🏢' },
  { value: 'maintenance', label: 'Mantenimiento',      icon: '🔧' },
  { value: 'insurance',   label: 'Seguros',            icon: '🛡️' },
  { value: 'other',       label: 'Otro',               icon: '📌' },
];

const kindLabel = (k: VendorKind) => KINDS.find(x => x.value === k)?.label ?? (k === 'cleaner' ? 'Aseo (legacy)' : k);
const kindIcon  = (k: VendorKind) => KINDS.find(x => x.value === k)?.icon  ?? '📌';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

const defaultCategoryFor = (k: VendorKind): ExpenseCategory => {
  if (k === 'utility') return 'Servicios públicos';
  if (k === 'admin') return 'Administración';
  if (k === 'maintenance') return 'Mantenimiento';
  if (k === 'insurance') return 'Administración';
  return 'Otros';
};

type PropShare = {
  propertyId: string;
  sharePercent: number | null;
  fixedAmount: number | null;
};

interface Form {
  name: string;
  kind: VendorKind;
  category: ExpenseCategory;
  defaultAmount: string;       // string para el input
  dayOfMonth: string;
  isVariable: boolean;
  contact: string;
  notes: string;
  active: boolean;
  props: PropShare[];
}

const EMPTY: Form = {
  name: '', kind: 'utility', category: 'Servicios públicos',
  defaultAmount: '', dayOfMonth: '', isVariable: false,
  contact: '', notes: '', active: true, props: [],
};

export default function VendorsClient(): JSX.Element {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [allVps, setAllVps] = useState<VendorPropertyRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [bills, setBills] = useState<SharedBillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VendorKind | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);
  const [paying, setPaying] = useState<{ vendor: Vendor; ym: string; estimated: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, pRes, vpRes, bRes, sbRes] = await Promise.all([
      listVendors(),
      listProperties(),
      listAllVendorProperties(),
      listBankAccounts(),
      listSharedBills(),
    ]);
    if (vRes.data)  setVendors(vRes.data.filter(v => v.kind !== 'cleaner'));
    if (pRes.data)  setProperties(pRes.data);
    if (vpRes.data) setAllVps(vpRes.data);
    if (bRes.data)  setBanks(bRes.data);
    if (sbRes.data) setBills(sbRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => filter === 'all' ? vendors : vendors.filter(v => v.kind === filter),
    [vendors, filter],
  );

  const countsByKind = useMemo(() => {
    const m = new Map<VendorKind, number>();
    for (const v of vendors) m.set(v.kind, (m.get(v.kind) ?? 0) + 1);
    return m;
  }, [vendors]);

  const propsCountByVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const vp of allVps) m.set(vp.vendor_id, (m.get(vp.vendor_id) ?? 0) + 1);
    return m;
  }, [allVps]);

  // Últimos 6 meses (incluido el actual) para la matriz
  const months = useMemo(() => {
    const nowYm = currentYearMonth();
    const [cy, cm] = nowYm.split('-').map(Number);
    let sy = cy, sm = cm - 5;
    while (sm <= 0) { sm += 12; sy -= 1; }
    return yearMonthRange(`${sy}-${String(sm).padStart(2, '0')}`, nowYm);
  }, []);

  // Map "vendorId::ym" → bill, para pintar la matriz
  const billByVendorMonth = useMemo(() => {
    const m = new Map<string, SharedBillRow>();
    for (const b of bills) m.set(`${b.vendor_id}::${b.year_month}`, b);
    return m;
  }, [bills]);

  const handleDeleteBill = async (b: SharedBillRow) => {
    if (!confirm(`Eliminar la factura de ${ymLabel(b.year_month)}? Se borrarán los gastos derivados.`)) return;
    const res = await deleteSharedBill(b.id);
    if (res.error) { alert(res.error); return; }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('recurring-period-changed'));
    await load();
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setErr(null); setModalOpen(true); };
  const openEdit = async (v: Vendor) => {
    setEditing(v);
    const vpRes = await listVendorProperties(v.id);
    const props: PropShare[] = (vpRes.data ?? []).map(vp => ({
      propertyId: vp.property_id,
      sharePercent: vp.share_percent,
      fixedAmount: vp.fixed_amount,
    }));
    setForm({
      name: v.name,
      kind: v.kind === 'cleaner' ? 'other' : v.kind,
      category: ((v.category as ExpenseCategory | null) && EXPENSE_CATEGORIES.includes(v.category as ExpenseCategory))
        ? (v.category as ExpenseCategory)
        : defaultCategoryFor(v.kind === 'cleaner' ? 'other' : v.kind),
      defaultAmount: v.default_amount != null ? String(v.default_amount) : '',
      dayOfMonth: v.day_of_month != null ? String(v.day_of_month) : '',
      isVariable: v.is_variable ?? false,
      contact: v.contact ?? '',
      notes: v.notes ?? '',
      active: v.active,
      props,
    });
    setErr(null);
    setModalOpen(true);
  };

  const toggleProp = (propertyId: string) => {
    setForm(f => {
      const exists = f.props.find(p => p.propertyId === propertyId);
      if (exists) return { ...f, props: f.props.filter(p => p.propertyId !== propertyId) };
      return { ...f, props: [...f.props, { propertyId, sharePercent: null, fixedAmount: null }] };
    });
  };

  const setPropShare = (propertyId: string, raw: string) => {
    setForm(f => ({
      ...f,
      props: f.props.map(p =>
        p.propertyId === propertyId
          ? { ...p, sharePercent: raw.trim() === '' ? null : Math.max(0, Math.min(100, Number(raw))), fixedAmount: raw.trim() === '' ? p.fixedAmount : null }
          : p,
      ),
    }));
  };

  const setPropFixed = (propertyId: string, raw: string) => {
    setForm(f => ({
      ...f,
      props: f.props.map(p =>
        p.propertyId === propertyId
          ? { ...p, fixedAmount: raw.trim() === '' ? null : Math.max(0, Number(raw)), sharePercent: raw.trim() === '' ? p.sharePercent : null }
          : p,
      ),
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      category: form.category,
      default_amount: form.defaultAmount.trim() === '' ? null : Number(form.defaultAmount),
      day_of_month: form.dayOfMonth.trim() === '' ? null : Math.max(1, Math.min(31, Number(form.dayOfMonth))),
      is_variable: form.isVariable,
      contact: form.contact.trim() || null,
      notes: form.notes.trim() || null,
      active: form.active,
    };
    const res = editing
      ? await updateVendor(editing.id, payload)
      : await createVendor(payload);
    if (res.error || !res.data) { setSaving(false); setErr(res.error ?? 'Error'); return; }

    const vendorId = res.data.id;
    const vpRes = await setVendorProperties(vendorId, form.props);
    setSaving(false);
    if (vpRes.error) { setErr(`Servicio guardado pero falló la asignación de propiedades: ${vpRes.error}`); return; }
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (v: Vendor) => {
    const res = await deleteVendor(v.id);
    if (res.error) { alert(res.error); return; }
    setConfirmDelete(null);
    await load();
  };

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Servicios y proveedores</h1>
          <p className="text-sm text-slate-500">Cada servicio define su monto mensual, las propiedades que cubre y cómo se reparte la factura. El aseo va por su propio módulo.</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm"
        >
          + Nuevo servicio
        </button>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          Todos ({vendors.length})
        </button>
        {KINDS.map(k => (
          <button
            key={k.value}
            onClick={() => setFilter(k.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              filter === k.value ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {k.icon} {k.label} ({countsByKind.get(k.value) ?? 0})
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-slate-500">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-500">No hay proveedores {filter !== 'all' ? `de "${kindLabel(filter as VendorKind)}"` : ''}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-5 py-3">Nombre</th>
                <th className="text-left px-5 py-3">Tipo</th>
                <th className="text-left px-5 py-3">Categoría</th>
                <th className="text-right px-5 py-3">Monto/mes</th>
                <th className="text-left px-5 py-3">Propiedades</th>
                <th className="text-left px-5 py-3">Estado</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(v => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{v.name}</td>
                  <td className="px-5 py-3 text-slate-600">{kindIcon(v.kind)} {kindLabel(v.kind)}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{v.category ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-700 text-right font-semibold">
                    {v.default_amount != null ? formatCurrency(Number(v.default_amount)) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {propsCountByVendor.get(v.id)
                      ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold">{propsCountByVendor.get(v.id)} propiedad{propsCountByVendor.get(v.id)! > 1 ? 'es' : ''}</span>
                      : <span className="text-xs text-slate-400">— sin asignar</span>}
                  </td>
                  <td className="px-5 py-3">
                    {v.active
                      ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Activo</span>
                      : <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs font-semibold">Inactivo</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => openEdit(v)} className="text-blue-600 hover:underline text-xs font-semibold mr-3">Editar</button>
                    <button onClick={() => setConfirmDelete(v)} className="text-red-600 hover:underline text-xs font-semibold">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Matriz mensual de pagos */}
      {!loading && filtered.length > 0 && (
        <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Matriz de pagos mensuales</h2>
              <p className="text-[11px] text-slate-500">Click en una celda para registrar o ver el pago. Verde = pagado, ámbar = pendiente.</p>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 sticky left-0 bg-slate-50">Servicio</th>
                  {months.map(ym => (
                    <th key={ym} className="text-center px-3 py-2 whitespace-nowrap">{ymLabel(ym)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(v => {
                  const props = propsCountByVendor.get(v.id) ?? 0;
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2 sticky left-0 bg-white">
                        <div className="font-medium text-slate-800 text-sm truncate max-w-[200px]" title={v.name}>{v.name}</div>
                        <div className="text-[10px] text-slate-500">{props} prop · {v.default_amount != null ? formatCurrency(Number(v.default_amount)) : '—'}</div>
                      </td>
                      {months.map(ym => {
                        const bill = billByVendorMonth.get(`${v.id}::${ym}`);
                        if (bill) {
                          return (
                            <td key={ym} className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteBill(bill)}
                                title={`Pagado el ${bill.paid_date} · ${formatCurrency(Number(bill.total_amount))}\nClick para anular`}
                                className="w-full px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-[11px] font-semibold"
                              >
                                ✓ {formatCurrency(Number(bill.total_amount))}
                              </button>
                            </td>
                          );
                        }
                        if (props === 0) {
                          return <td key={ym} className="px-2 py-1.5 text-center text-slate-300">—</td>;
                        }
                        const estimated = Number(v.default_amount ?? 0);
                        return (
                          <td key={ym} className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => setPaying({ vendor: v, ym, estimated })}
                              title={`Pendiente · estimado ${formatCurrency(estimated)}`}
                              className="w-full px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-semibold"
                            >
                              ⏳ Pagar
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AnimatePresence>
        {paying && (
          <SharedBillPayModal
            vendor={paying.vendor}
            yearMonth={paying.ym}
            estimatedAmount={paying.estimated}
            banks={banks}
            onClose={() => setPaying(null)}
            onSaved={() => { setPaying(null); load(); }}
          />
        )}
      </AnimatePresence>

      {/* Modal crear/editar */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            {...makeBackdropHandlers(() => setModalOpen(false))}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseUp={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                {editing ? 'Editar proveedor' : 'Nuevo proveedor'}
              </h3>

              {err && <p className="text-xs text-red-600 mb-3">{err}</p>}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Claro, EPM, Juanita"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo *</label>
                  <select
                    value={form.kind}
                    onChange={e => {
                      const newKind = e.target.value as VendorKind;
                      setForm(f => ({ ...f, kind: newKind, category: defaultCategoryFor(newKind) }));
                    }}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    {KINDS.map(k => <option key={k.value} value={k.value}>{k.icon} {k.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Categoría contable *</label>
                  <select
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">Con esta categoría se crearán los gastos al pagar la factura.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Monto mensual estimado</label>
                    <input
                      type="number"
                      value={form.defaultAmount}
                      onChange={e => setForm({ ...form, defaultAmount: e.target.value })}
                      min={0}
                      step="any"
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Día del mes</label>
                    <input
                      type="number"
                      min={1} max={31}
                      value={form.dayOfMonth}
                      onChange={e => setForm({ ...form, dayOfMonth: e.target.value })}
                      placeholder="ej. 15"
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100">
                  <input
                    type="checkbox"
                    checked={form.isVariable}
                    onChange={e => setForm({ ...form, isVariable: e.target.checked })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-700">El monto cambia mes a mes</div>
                    <div className="text-[11px] text-slate-500">Marca esto si el total varía (ej. luz, gas, agua). Al pagar, el sistema te pedirá el total real y el monto exacto que paga cada apartamento.</div>
                  </div>
                </label>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
                  <input
                    type="text"
                    value={form.contact}
                    onChange={e => setForm({ ...form, contact: e.target.value })}
                    placeholder="Teléfono, email o ambos"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => setForm({ ...form, active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  Activo
                </label>

                <div className="pt-3 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Propiedades cubiertas
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Marca las propiedades que paga este servicio. Reglas de reparto al pagar la factura mensual:<br/>
                    <span className="font-semibold">monto fijo</span> tiene prioridad; si no, se usa el <span className="font-semibold">%</span>;
                    si no hay nada, se reparte por partes iguales.
                  </p>
                  {properties.length === 0 ? (
                    <p className="text-xs text-slate-400">No tienes propiedades creadas aún.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {properties.map(p => {
                        const sel = form.props.find(fp => fp.propertyId === p.id);
                        return (
                          <div key={p.id} className="px-3 py-2 hover:bg-slate-50">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!sel}
                                onChange={() => toggleProp(p.id)}
                                className="w-4 h-4"
                              />
                              <span className="flex-1 text-sm text-slate-700 truncate">{p.name}</span>
                            </label>
                            {sel && (
                              <div className="grid grid-cols-2 gap-2 mt-2 ml-6">
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Monto fijo</label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={sel.fixedAmount ?? ''}
                                    onChange={e => setPropFixed(p.id, e.target.value)}
                                    placeholder="—"
                                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 outline-none text-right"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">o % del total</label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    value={sel.sharePercent ?? ''}
                                    onChange={e => setPropShare(p.id, e.target.value)}
                                    placeholder="auto"
                                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 outline-none text-right"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {form.props.length > 0 && (() => {
                    const fixed = form.props.filter(p => p.fixedAmount != null);
                    const pct   = form.props.filter(p => p.fixedAmount == null && p.sharePercent != null);
                    const eq    = form.props.filter(p => p.fixedAmount == null && p.sharePercent == null);
                    const fixedSum = fixed.reduce((s, p) => s + (p.fixedAmount ?? 0), 0);
                    const pctSum   = pct.reduce((s, p) => s + (p.sharePercent ?? 0), 0);
                    return (
                      <p className="text-[11px] text-slate-600 mt-1">
                        {fixed.length > 0 && <>Fijos: {formatCurrency(fixedSum)} · </>}
                        {pct.length > 0 && <>%: {pctSum.toFixed(1)}% · </>}
                        {eq.length > 0 && <>{eq.length} con reparto igual del resto</>}
                      </p>
                    );
                  })()}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
                <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm delete */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            {...makeBackdropHandlers(() => setConfirmDelete(null))}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseUp={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <h3 className="text-lg font-bold text-slate-800 mb-2">Eliminar proveedor</h3>
              <p className="text-sm text-slate-600 mb-5">
                ¿Seguro que deseas eliminar <b>{confirmDelete.name}</b>? Los gastos o aseos que lo referenciaban quedarán sin proveedor pero no se eliminarán.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700">Eliminar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
