'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type {
  PropertyRow, VendorPropertyRow, BankAccountRow,
  SharedBillRow, VendorKind, ExpenseRow,
} from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import { listAllVendorProperties } from '@/services/vendorProperties';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { listSharedBills, deleteSharedBill } from '@/services/sharedBills';
import { currentYearMonth, yearMonthRange } from '@/services/recurringPeriods';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/lib/toast';
import SharedBillPayModal from './SharedBillPayModal';
import VendorPaymentsMatrixExpandable from './vendors/VendorPaymentsMatrixExpandable';
import { ymLabel } from './vendors/vendorTypes';

/** Vendor kinds visible in this view (utilities + administration block) */
const VISIBLE_KINDS: VendorKind[] = ['utility', 'admin', 'business_service', 'tax', 'insurance'];

export default function ServicesAdminClient(): JSX.Element {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [vps, setVps] = useState<VendorPropertyRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [bills, setBills] = useState<SharedBillRow[]>([]);
  const [billExpenses, setBillExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'utility' | 'admin'>('all');
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
    if (vRes.data)  setVendors(vRes.data.filter(v => VISIBLE_KINDS.includes(v.kind)));
    if (pRes.data)  setProperties(pRes.data);
    if (vpRes.data) setVps(vpRes.data);
    if (bRes.data)  setBanks(bRes.data);
    if (sbRes.data) setBills(sbRes.data);

    // Fetch the per-property breakdown for all shared bills (single query).
    if (sbRes.data && sbRes.data.length > 0) {
      const billIds = sbRes.data.map(b => b.id);
      const { data: expData } = await supabase
        .from('expenses')
        .select('*')
        .in('shared_bill_id', billIds);
      setBillExpenses((expData ?? []) as ExpenseRow[]);
    } else {
      setBillExpenses([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const nowYm = useMemo(() => currentYearMonth(), []);

  // Últimos 5 meses + actual + 1 mes hacia adelante (para pagar adelantado)
  const months = useMemo(() => {
    const [cy, cm] = nowYm.split('-').map(Number);
    let sy = cy, sm = cm - 5;
    while (sm <= 0) { sm += 12; sy -= 1; }
    const fromYm = `${sy}-${String(sm).padStart(2, '0')}`;
    let ny = cy, nm = cm + 1;
    if (nm > 12) { nm -= 12; ny += 1; }
    const toYm = `${ny}-${String(nm).padStart(2, '0')}`;
    return yearMonthRange(fromYm, toYm);
  }, [nowYm]);

  const billByVendorMonth = useMemo(() => {
    const m = new Map<string, SharedBillRow>();
    for (const b of bills) m.set(`${b.vendor_id}::${b.year_month}`, b);
    return m;
  }, [bills]);

  // Build "vendorId::propertyId::ym" → amount paid (from derived expenses).
  const expenseByVendorPropMonth = useMemo(() => {
    const billMap = new Map<string, SharedBillRow>(bills.map(b => [b.id, b]));
    const m = new Map<string, number>();
    for (const e of billExpenses) {
      if (!e.shared_bill_id || !e.property_id) continue;
      const bill = billMap.get(e.shared_bill_id);
      if (!bill) continue;
      const key = `${bill.vendor_id}::${e.property_id}::${bill.year_month}`;
      m.set(key, (m.get(key) ?? 0) + Number(e.amount));
    }
    return m;
  }, [billExpenses, bills]);

  const filteredVendors = useMemo(() => {
    if (filter === 'all') return vendors;
    if (filter === 'utility') return vendors.filter(v => v.kind === 'utility');
    // 'admin' = administración + saas + tax + insurance
    return vendors.filter(v => v.kind !== 'utility');
  }, [vendors, filter]);

  const handleDeleteBill = async (b: SharedBillRow) => {
    if (!confirm(`Eliminar la factura de ${ymLabel(b.year_month)}? Se borrarán los gastos derivados.`)) return;
    const res = await deleteSharedBill(b.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Factura eliminada');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('recurring-period-changed'));
    await load();
  };

  const counts = useMemo(() => ({
    all: vendors.length,
    utility: vendors.filter(v => v.kind === 'utility').length,
    admin: vendors.filter(v => v.kind !== 'utility').length,
  }), [vendors]);

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-slate-800">Servicios y administración</h1>
          <p className="text-sm text-slate-500 mt-1">
            Matriz mes a mes de <strong>servicios públicos</strong> (luz, agua, gas, internet) y{' '}
            <strong>administración</strong> (plataformas SaaS, contador, predial, seguros).{' '}
            Expande cada fila para ver el desglose por propiedad. Puedes registrar el pago del mes en curso
            o adelantar el del próximo.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            Para crear, editar o eliminar proveedores, ve a{' '}
            <a href="/vendors" className="text-blue-600 hover:underline font-medium">Servicios y proveedores</a>.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          Todos ({counts.all})
        </button>
        <button
          onClick={() => setFilter('utility')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'utility' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          💡 Servicios públicos ({counts.utility})
        </button>
        <button
          onClick={() => setFilter('admin')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'admin' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          🏢 Administración ({counts.admin})
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando…</p>
      ) : filteredVendors.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-500">No hay proveedores en esta categoría.</p>
          <a href="/vendors" className="mt-3 inline-block text-sm font-semibold text-blue-600 hover:underline">
            Crear un proveedor →
          </a>
        </div>
      ) : (
        <VendorPaymentsMatrixExpandable
          vendors={filteredVendors}
          properties={properties}
          vendorProperties={vps}
          months={months}
          billByVendorMonth={billByVendorMonth}
          expenseByVendorPropMonth={expenseByVendorPropMonth}
          currentYm={nowYm}
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
    </div>
  );
}
