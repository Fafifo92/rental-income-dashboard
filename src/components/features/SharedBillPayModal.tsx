import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { type BankAccountRow, type VendorRow, type VendorPropertyRow, type PropertyRow, EXPENSE_CATEGORIES } from '@/types/database';
import { listVendorProperties, computeShares } from '@/services/vendorProperties';
import { listProperties } from '@/services/properties';
import { createSharedBill } from '@/services/sharedBills';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { addMoney } from '@/lib/money';
import MoneyInput from '@/components/MoneyInput';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

const CATEGORIES = EXPENSE_CATEGORIES;

export default function SharedBillPayModal({
  vendor, yearMonth, estimatedAmount, banks, onClose, onSaved,
}: {
  vendor: VendorRow;
  yearMonth: string;
  estimatedAmount: number;
  banks: BankAccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isVariable = vendor.is_variable === true;
  const [vps, setVps] = useState<VendorPropertyRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [amount, setAmount] = useState<number | null>(estimatedAmount || null);
  const [perProp, setPerProp] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(() => {
    const [y, m] = yearMonth.split('-').map(Number);
    const today = new Date();
    const day = (today.getFullYear() === y && today.getMonth() + 1 === m)
      ? today.getDate()
      : new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
  const [bankId, setBankId] = useState<string>('');
  const [category, setCategory] = useState<string>(() => {
    if (vendor.kind === 'utility') return 'Servicios públicos';
    if (vendor.kind === 'admin') return 'Administración';
    if (vendor.kind === 'maintenance') return 'Mantenimiento';
    if (vendor.kind === 'insurance') return 'Administración';
    return 'Otros';
  });
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [vpRes, pRes] = await Promise.all([
        listVendorProperties(vendor.id),
        listProperties(),
      ]);
      if (vpRes.data) setVps(vpRes.data);
      if (pRes.data) setProperties(pRes.data);
    })();
  }, [vendor.id]);

  const propName = (id: string) => properties.find(p => p.id === id)?.name ?? id.slice(0, 8);

  const parsedAmount = amount ?? 0;

  // Suma de los montos por propiedad (modo variable) — aritmética en centavos.
  const perPropSum = useMemo(() => {
    return addMoney(...Object.values(perProp));
  }, [perProp]);

  // Si modo variable: total = suma; si fijo: usa amount manual y previo
  const effectiveTotal = isVariable ? perPropSum : parsedAmount;
  const preview = useMemo(
    () => isVariable ? new Map<string, number>() : computeShares(parsedAmount, vps),
    [parsedAmount, vps, isVariable],
  );

  const setPropAmount = (propId: string, v: number | null) => {
    setPerProp(p => ({ ...p, [propId]: v }));
  };

  const handleSave = async () => {
    if (vps.length === 0) { setErr('Este proveedor no tiene propiedades asignadas.'); return; }
    if (!date) { setErr('Fecha requerida.'); return; }

    let perPropertyAmounts: Map<string, number> | null = null;
    let total = parsedAmount;

    if (isVariable) {
      const map = new Map<string, number>();
      for (const vp of vps) {
        const v = perProp[vp.property_id];
        if (v == null || !Number.isFinite(v) || v < 0) {
          setErr(`Falta el monto de "${propName(vp.property_id)}".`);
          return;
        }
        map.set(vp.property_id, v);
      }
      total = addMoney(...map.values());
      if (total <= 0) { setErr('La suma de montos por propiedad debe ser > 0.'); return; }
      perPropertyAmounts = map;
    } else {
      if (parsedAmount <= 0) { setErr('El monto total debe ser mayor a 0.'); return; }
    }

    if (!bankId) { setErr('Indica de qué cuenta bancaria salió el dinero (obligatorio para pagos).'); return; }

    setSaving(true);
    const res = await createSharedBill({
      vendorId: vendor.id,
      yearMonth,
      totalAmount: total,
      paidDate: date,
      bankAccountId: bankId,
      category,
      notes: notes.trim() || null,
      perPropertyAmounts,
    });
    setSaving(false);
    if (res.error) { setErr(res.error); return; }
    window.dispatchEvent(new CustomEvent('recurring-period-changed'));
    onSaved();
  };

  return (
    <motion.div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-1">Pagar factura {isVariable ? 'variable' : 'compartida'}</h3>
        <p className="text-sm text-slate-500 mb-4">
          <span className="font-semibold">{vendor.name}</span> · {ymLabel(yearMonth)}
          {isVariable && <span className="ml-2 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">monto variable</span>}
        </p>

        {err && <p className="text-xs text-red-600 mb-3 bg-red-50 border border-red-200 p-2 rounded">{err}</p>}

        <div className="space-y-3">
          {!isVariable && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Monto total de la factura</label>
              <MoneyInput value={amount} onChange={setAmount} />
              {estimatedAmount > 0 && (
                <p className="text-[11px] text-slate-500 mt-1">Estimado: {formatCurrency(estimatedAmount)}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de pago</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Categoría</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta bancaria <span className="text-rose-600">*</span></label>
            <select
              required
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white ${
                !bankId ? 'border-rose-300' : ''
              }`}
            >
              <option value="">— Selecciona la cuenta —</option>
              {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">Obligatorio: necesitamos saber de qué cuenta sale el dinero.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-2">
              {isVariable ? 'Monto que paga cada propiedad este mes' : 'Reparto por propiedad'}
            </p>
            {vps.length === 0 ? (
              <p className="text-xs text-slate-400">Sin propiedades asignadas.</p>
            ) : isVariable ? (
              <div className="border border-amber-200 bg-amber-50/40 rounded-lg divide-y divide-amber-100 max-h-56 overflow-y-auto">
                {vps.map(vp => (
                  <div key={vp.property_id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-sm text-slate-700 flex-1 truncate">{propName(vp.property_id)}</span>
                    <MoneyInput
                      value={perProp[vp.property_id] ?? null}
                      onChange={(v) => setPropAmount(vp.property_id, v)}
                      placeholder="0"
                      className="w-36"
                      inputClassName="text-right"
                    />
                  </div>
                ))}
                <div className="flex justify-between items-center px-3 py-2 bg-amber-100 font-semibold text-sm">
                  <span className="text-amber-900">Total a pagar</span>
                  <span className="text-amber-900">{formatCurrency(effectiveTotal)}</span>
                </div>
              </div>
            ) : (
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {vps.map(vp => (
                  <li key={vp.property_id} className="flex justify-between items-center px-3 py-1.5 text-sm">
                    <span className="text-slate-700 truncate">{propName(vp.property_id)}</span>
                    <span className="text-slate-800 font-semibold">{formatCurrency(preview.get(vp.property_id) ?? 0)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              Se creará 1 gasto "pagado" por propiedad, vinculado a la factura.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Registrar pago'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
