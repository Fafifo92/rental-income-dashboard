'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { type VendorKind, type PropertyRow, type VendorPropertyRow, type BankAccountRow, type SharedBillRow, type CreditPoolRow, type ExpenseCategory, EXPENSE_CATEGORIES } from '@/types/database';
import { listVendors, createVendor, updateVendor, deleteVendor, type Vendor } from '@/services/vendors';
import { listCreditPools, createCreditPool, updateCreditPool, type CreateCreditPoolInput } from '@/services/creditPools';
import { listVendorProperties, setVendorProperties, listAllVendorProperties } from '@/services/vendorProperties';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { listSharedBills, deleteSharedBill } from '@/services/sharedBills';
import { currentYearMonth, yearMonthRange } from '@/services/recurringPeriods';
import { todayISO } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/utils';
import SharedBillPayModal from './SharedBillPayModal';
import { toast } from '@/lib/toast';
import {
  KINDS_FORM, kindLabel, kindIcon, defaultCategoryFor, ymLabel,
  type VendorForm, type PropShare, EMPTY_VENDOR_FORM,
} from './vendors/vendorTypes';
import VendorFormModal from './vendors/VendorFormModal';
import VendorConfirmDeleteModal from './vendors/VendorConfirmDeleteModal';
import VendorPaymentsMatrix from './vendors/VendorPaymentsMatrix';

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
  const [form, setForm] = useState<VendorForm>(EMPTY_VENDOR_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);
  const [paying, setPaying] = useState<{ vendor: Vendor; ym: string; estimated: number } | null>(null);
  const [editingPool, setEditingPool] = useState<CreditPoolRow | null>(null);

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

  // Cuando se llega a /vendors?new=1 (desde el botón de los formularios de
  // gasto), abre directamente el modal de "Nuevo proveedor".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setEditing(null);
      setForm(EMPTY_VENDOR_FORM);
      setErr(null);
      setModalOpen(true);
      // limpiar la query para que no se reabra al refrescar
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

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
    if (res.error) { toast.error(res.error); return; }
    toast.success('Factura eliminada');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('recurring-period-changed'));
    await load();
  };

  const openNew = () => { setEditing(null); setForm(EMPTY_VENDOR_FORM); setErr(null); setEditingPool(null); setModalOpen(true); };
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
      startYearMonth: v.start_year_month ?? '',
      isVariable: v.is_variable ?? false,
      contact: v.contact ?? '',
      notes: v.notes ?? '',
      active: v.active,
      props,
      poolEnabled: false,
      poolCreditsTotal: '',
      poolConsumptionRule: 'per_person_per_night',
      poolCreditsPerUnit: '1',
      poolChildWeight: '1',
      poolActivatedAt: todayISO(),
      poolExpiresAt: '',
    });
    setErr(null);
    // Load linked credit pool for insurance vendors
    if (v.kind === 'insurance') {
      const cpRes = await listCreditPools();
      const existingPool = cpRes.data?.find(p => p.vendor_id === v.id && p.status !== 'archived') ?? null;
      setEditingPool(existingPool);
      if (existingPool) {
        setForm(f => ({
          ...f,
          poolEnabled: true,
          poolCreditsTotal: String(existingPool.credits_total),
          poolConsumptionRule: existingPool.consumption_rule,
          poolCreditsPerUnit: String(existingPool.credits_per_unit),
          poolChildWeight: String(existingPool.child_weight),
          poolActivatedAt: existingPool.activated_at,
          poolExpiresAt: existingPool.expires_at ?? '',
        }));
      } else {
        setEditingPool(null);
      }
    } else {
      setEditingPool(null);
    }
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
      start_year_month: form.startYearMonth.trim() === '' ? null : form.startYearMonth.trim(),
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
    // If insurance vendor with pool enabled → create or update credit pool
    if (form.kind === 'insurance' && form.poolEnabled && Number(form.poolCreditsTotal) > 0) {
      const poolPayload: CreateCreditPoolInput = {
        vendor_id: vendorId,
        name: form.name.trim(),
        credits_total: Number(form.poolCreditsTotal),
        total_price: Number(form.defaultAmount) || 0,
        consumption_rule: form.poolConsumptionRule,
        credits_per_unit: Number(form.poolCreditsPerUnit) || 1,
        child_weight: Number(form.poolChildWeight) || 1,
        activated_at: form.poolActivatedAt,
        expires_at: form.poolExpiresAt || null,
        notes: null,
      };
      if (editingPool) {
        await updateCreditPool(editingPool.id, poolPayload);
      } else {
        await createCreditPool(poolPayload);
      }
    }
    setSaving(false);
    if (vpRes.error) { setErr(`Servicio guardado pero falló la asignación de propiedades: ${vpRes.error}`); return; }
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (v: Vendor) => {
    const res = await deleteVendor(v.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`"${v.name}" eliminado`);
    setConfirmDelete(null);
    await load();
  };

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-slate-800">Proveedores y gastos del negocio</h1>
          <p className="text-sm text-slate-500 mt-1">
            Aquí van los <strong>gastos del rubro</strong>: suscripciones SaaS, persona que administra, contador, predial, impuestos, mantenimiento o seguros.{' '}
            Los <strong>servicios públicos</strong> (luz, agua, gas, internet) se configuran como gasto recurrente dentro de cada propiedad. El aseo va por su propio módulo.
          </p>
        </div>
        <button
          onClick={openNew}
          className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm"
        >
          <span className="text-base leading-none">+</span> Nuevo proveedor
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
        {KINDS_FORM.map(k => (
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

      {!loading && filtered.length > 0 && (
        <VendorPaymentsMatrix
          vendors={filtered}
          months={months}
          propsCountByVendor={propsCountByVendor}
          billByVendorMonth={billByVendorMonth}
          onDeleteBill={handleDeleteBill}
          onPay={(v, ym, estimated) => setPaying({ vendor: v, ym, estimated })}
        />
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

      <AnimatePresence>
        {modalOpen && (
          <VendorFormModal
            editing={editing}
            form={form}
            setForm={setForm}
            err={err}
            saving={saving}
            editingPool={editingPool}
            properties={properties}
            toggleProp={toggleProp}
            setPropShare={setPropShare}
            setPropFixed={setPropFixed}
            onSave={handleSave}
            onClose={() => setModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <VendorConfirmDeleteModal
            vendor={confirmDelete}
            onConfirm={() => handleDelete(confirmDelete)}
            onClose={() => setConfirmDelete(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


