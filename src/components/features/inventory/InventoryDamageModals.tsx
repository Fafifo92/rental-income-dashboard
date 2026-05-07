'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  reportItemDamage,
  getDamageReconciliations,
  recoverDamageAmount,
  type DamageReconciliation,
} from '@/services/inventory';
import { listBookings } from '@/services/bookings';
import { listBankAccounts } from '@/services/bankAccounts';
import type {
  BankAccountRow,
  BookingRow,
  InventoryItemRow,
} from '@/types/database';
import { useBackdropClose, makeBackdropHandlers } from '@/lib/useBackdropClose';
import { formatCurrency } from '@/lib/utils';
import { todayISO } from '@/lib/dateUtils';
import MoneyInput from '@/components/MoneyInput';
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// DamageReportModal
// Reporta da├▒o + (opcional) atribuir a reserva + (opcional) cobrar al hu├®sped.
// Crea autom├íticamente: gasto pendiente (Reparaci├│n inventario), ajuste de
// reserva damage_charge (si aplica) y movimiento de inventario, todo enlazado.
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
export function DamageReportModal({
  item, propertyName, onClose, onSaved,
}: {
  item: InventoryItemRow;
  propertyName: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [listingSourceById, setListingSourceById] = useState<Map<string, string>>(new Map());
  const [bookingId, setBookingId] = useState<string>('');
  const [repairCost, setRepairCost] = useState<number | null>(
    item.purchase_price ? Number(item.purchase_price) : null,
  );
  const [chargeBack, setChargeBack] = useState(false);
  const [chargeAmount, setChargeAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await listBookings({ propertyIds: [item.property_id] });
      if (!res.data) return;
      const today = todayISO();
      const sorted = [...res.data].sort((a, b) => {
        const aActive = a.start_date <= today && a.end_date >= today ? 0 : 1;
        const bActive = b.start_date <= today && b.end_date >= today ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return b.start_date.localeCompare(a.start_date);
      });
      setBookings(sorted.slice(0, 50));
      // Cargar source de cada listing para distinguir directo vs plataforma
      const listingIds = Array.from(new Set(sorted.map(b => b.listing_id)));
      if (listingIds.length > 0) {
        const { supabase } = await import('@/lib/supabase/client');
        const lr = await supabase.from('listings').select('id,source').in('id', listingIds);
        if (lr.data) {
          const m = new Map<string, string>();
          for (const l of lr.data) m.set(l.id, l.source);
          setListingSourceById(m);
        }
      }
    })();
  }, [item.property_id]);

  const selectedBooking = useMemo(
    () => bookings.find(b => b.id === bookingId) ?? null,
    [bookings, bookingId],
  );
  const selectedSource = selectedBooking ? listingSourceById.get(selectedBooking.listing_id) : null;
  const chargeTargetLabel =
    !selectedSource ? 'hu├®sped'
    : /direct|directo/i.test(selectedSource) ? 'hu├®sped (reserva directa)'
    : `la plataforma (${selectedSource})`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const cost = repairCost ?? 0;
    const charge = chargeAmount;
    const res = await reportItemDamage({
      item_id: item.id,
      item_name: item.name,
      property_id: item.property_id,
      booking_id: bookingId,
      repair_cost: cost,
      description: description.trim() || null,
      charge_to_guest: chargeBack && !!bookingId,
      charge_amount: charge,
    });
    setSaving(false);
    if (res.error) { setErr(res.error); return; }
    await onSaved();
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">ÔÜá Reportar da├▒o</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            <strong>{item.name}</strong> ┬À {propertyName}{item.location ? ` ┬À ${item.location}` : ''}
          </p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 space-y-1">
            <p className="font-semibold">Al guardar se har├í autom├íticamente:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>El item queda marcado como <strong>Da├▒ado</strong>.</li>
              <li>Se crea un <strong>gasto pendiente</strong> "Reparaci├│n inventario" con el costo estimado.</li>
              <li>Si lo atribuyes a una reserva, queda <strong>vinculado</strong> a esa reserva.</li>
              <li>Si activas el cobro al hu├®sped, se crea un <strong>cobro por da├▒o</strong> en la reserva.</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">┬┐Durante qu├® reserva ocurri├│? *</label>
            <select
              required
              value={bookingId}
              onChange={e => setBookingId(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">ÔÇö Selecciona la reserva ÔÇö</option>
              {bookings.map(b => (
                <option key={b.id} value={b.id}>
                  {b.confirmation_code} ┬À {b.guest_name ?? 'Hu├®sped'} ┬À {b.start_date} ÔåÆ {b.end_date}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Todo da├▒o debe estar asociado a una reserva (activas primero, luego m├ís recientes).
              Si la reserva no est├í aqu├¡, cr├®ala antes de registrar el da├▒o.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Costo estimado de reparaci├│n / reposici├│n *</label>
            <MoneyInput value={repairCost} onChange={setRepairCost} required placeholder="0" />
            <p className="text-[10px] text-slate-400 mt-1">
              Pre-cargado con el precio de compra si existe. Usa coma para centavos.
            </p>
          </div>

          {bookingId && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chargeBack}
                  onChange={e => setChargeBack(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="font-semibold text-slate-700">
                  Cobrar este da├▒o a {chargeTargetLabel}
                </span>
              </label>
              <p className="text-[10px] text-slate-500">
                Se registra un <strong>cobro por da├▒o</strong> en la reserva. Si la reserva es de plataforma,
                lo cobra la plataforma; si es directa, lo cobras directo al hu├®sped.
              </p>
              {chargeBack && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Monto a cobrar (vac├¡o = igual al costo de reparaci├│n)
                  </label>
                  <MoneyInput value={chargeAmount} onChange={setChargeAmount} placeholder="0" />
                  {repairCost !== null && chargeAmount !== null && chargeAmount !== repairCost && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                      ÔÜá Diferencia detectada: cobras {formatCurrency(chargeAmount)} pero el da├▒o cuesta {formatCurrency(repairCost)}.
                      {chargeAmount < repairCost
                        ? ` Faltar├¡an ${formatCurrency(repairCost - chargeAmount)} por cubrir (queda como ajuste pendiente).`
                        : ` Sobran ${formatCurrency(chargeAmount - repairCost)} (excedente a tu favor).`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Descripci├│n del da├▒o</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="Ej: Pata partida tras checkout, taza fracturada, control remoto perdidoÔÇª"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-50">
              {saving ? 'GuardandoÔÇª' : 'Reportar da├▒o'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}



// ---------- Secci├│n 14B: Reconciliaci├│n de da├▒os ----------
export function DamageReconciliationSection(): JSX.Element | null {
  const [rows, setRows] = useState<DamageReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [recovering, setRecovering] = useState<DamageReconciliation | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    getDamageReconciliations().then(res => {
      setRows(res.data ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const open = rows.filter(r =>
    r.status === 'pending_recovery' ||
    r.status === 'overpaid' ||
    r.status === 'no_charge' ||
    (r.status === 'pending_repair' && r.repair_cost > 0),
  );

  if (loading) return null;
  if (open.length === 0) return null;

  const totalPendingRecovery = open
    .filter(r => r.status === 'pending_recovery')
    .reduce((s, r) => s + Math.abs(r.diff), 0);
  const totalOverpaid = open
    .filter(r => r.status === 'overpaid')
    .reduce((s, r) => s + r.diff, 0);
  const totalNoCharge = open
    .filter(r => r.status === 'no_charge')
    .reduce((s, r) => s + r.repair_cost, 0);

  return (
    <section className="bg-white rounded-xl border-l-4 border-amber-400 border-y border-r border-amber-200 p-5 mb-6">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-bold text-amber-800 flex items-center gap-2">
            ÔÜá´©Å Da├▒os sin reconciliar ({open.length})
          </h2>
          <p className="text-xs text-amber-700/80 mt-0.5">
            Diferencias entre lo que cobraste al hu├®sped/plataforma y lo que cost├│ realmente reparar.
          </p>
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded"
        >
          {collapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </header>

      {!collapsed && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-rose-700">Falta recuperar</div>
              <div className="text-lg font-bold text-rose-800">{formatCurrency(totalPendingRecovery)}</div>
              <div className="text-[11px] text-rose-700/80">Cobraste menos de lo que cost├│</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-emerald-700">Sobrante</div>
              <div className="text-lg font-bold text-emerald-800">{formatCurrency(totalOverpaid)}</div>
              <div className="text-[11px] text-emerald-700/80">Plataforma pag├│ de m├ís</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-slate-600">Asumido por el negocio</div>
              <div className="text-lg font-bold text-slate-800">{formatCurrency(totalNoCharge)}</div>
              <div className="text-[11px] text-slate-500">Sin cobro al hu├®sped</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th className="text-left py-2 px-2">Item / Propiedad</th>
                  <th className="text-left py-2 px-2">Reserva</th>
                  <th className="text-right py-2 px-2">Costo</th>
                  <th className="text-right py-2 px-2">Cobrado</th>
                  <th className="text-right py-2 px-2">Diferencia</th>
                  <th className="text-left py-2 px-2">Estado</th>
                  <th className="text-right py-2 px-2">Acci├│n</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {open.map(r => (
                  <tr key={r.movement_id} className="hover:bg-amber-50/30">
                    <td className="py-2 px-2">
                      <div className="font-medium text-slate-800">{r.item_name}</div>
                      <div className="text-[11px] text-slate-500">{r.property_name ?? 'ÔÇö'}</div>
                    </td>
                    <td className="py-2 px-2">
                      {r.booking_id ? (
                        <a
                          href={`/bookings?focus=${r.booking_id}`}
                          className="text-blue-600 hover:underline text-xs font-mono"
                        >
                          {r.booking_code ?? r.booking_id.slice(0, 8)}
                        </a>
                      ) : <span className="text-slate-400 text-xs">ÔÇö</span>}
                      {r.guest_name && (
                        <div className="text-[11px] text-slate-500 truncate max-w-[160px]" title={r.guest_name}>
                          {r.guest_name}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-700">
                      {formatCurrency(r.repair_cost)}
                      {r.expense_status === 'pending' && (
                        <div className="text-[10px] text-amber-600">ÔÅ│ pendiente pago</div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-700">
                      {formatCurrency(r.charged_to_guest)}
                    </td>
                    <td className={`py-2 px-2 text-right font-bold ${
                      r.diff < 0 ? 'text-rose-700' : r.diff > 0 ? 'text-emerald-700' : 'text-slate-500'
                    }`}>
                      {r.diff < 0 ? 'ÔêÆ' : r.diff > 0 ? '+' : ''}{formatCurrency(Math.abs(r.diff))}
                    </td>
                    <td className="py-2 px-2">
                      {r.status === 'pending_recovery' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                          Falta recuperar
                        </span>
                      )}
                      {r.status === 'overpaid' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          Sobrante
                        </span>
                      )}
                      {r.status === 'no_charge' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          Sin cobro
                        </span>
                      )}
                      {r.status === 'pending_repair' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                          Pago pendiente
                        </span>
                      )}
                      {!r.is_repaired && r.expense_status === 'paid' && (
                        <div className="text-[10px] text-slate-400 mt-0.5">Item a├║n da├▒ado</div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {(r.status === 'pending_recovery' || r.status === 'no_charge') && r.booking_id && r.expense_id ? (
                        <button
                          onClick={() => setRecovering(r)}
                          className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          ­ƒÆ░ Registrar recuperaci├│n
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300">ÔÇö</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500 mt-3 space-y-1">
            <p>
              ­ƒÆí <strong>┬┐C├│mo cierro una diferencia?</strong>
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Falta recuperar:</strong> usa "­ƒÆ░ Registrar recuperaci├│n" para indicar cu├ínto te dio la plataforma/hu├®sped y a qu├® cuenta cay├│.</li>
              <li><strong>Sobrante:</strong> recibiste m├ís de lo que cost├│ ÔÇö la diferencia queda como ingreso adicional para el negocio.</li>
              <li><strong>Sin cobro:</strong> registra una recuperaci├│n cuando recibas la plata, o asume el costo como gasto del negocio.</li>
            </ul>
          </div>
        </>
      )}
      <AnimatePresence>
        {recovering && (
          <RecoverDamageModal
            row={recovering}
            onClose={() => setRecovering(null)}
            onSaved={() => { setRecovering(null); reload(); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

export function RecoverDamageModal({
  row, onClose, onSaved,
}: {
  row: DamageReconciliation;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const missing = Math.max(0, row.repair_cost - row.charged_to_guest);
  const [amount, setAmount] = useState<number | null>(missing > 0 ? missing : null);
  const [bankId, setBankId] = useState<string>('');
  const [date, setDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState<string>('');
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdrop = makeBackdropHandlers(onClose);

  useEffect(() => {
    listBankAccounts().then(res => {
      const list = (res.data ?? []).filter(a => a.is_active);
      setAccounts(list);
      if (list.length > 0 && !bankId) setBankId(list[0].id);
    });
  }, []);

  const totalAfter = row.charged_to_guest + (Number(amount) || 0);
  const profit = totalAfter - row.repair_cost;

  const handleSave = async () => {
    if (!amount || amount <= 0) { setError('Indica el monto recuperado.'); return; }
    if (!bankId) { setError('Selecciona la cuenta donde cay├│ el dinero.'); return; }
    if (!row.expense_id || !row.booking_id) { setError('Da├▒o sin reserva o gasto asociado.'); return; }
    setSaving(true);
    setError(null);
    const res = await recoverDamageAmount({
      expense_id: row.expense_id,
      booking_id: row.booking_id,
      amount: Number(amount),
      bank_account_id: bankId,
      date,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-800">­ƒÆ░ Registrar recuperaci├│n de da├▒o</h3>
        <p className="text-xs text-slate-500 mt-1">
          {row.item_name} ┬À {row.property_name ?? 'Sin propiedad'}
        </p>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-slate-500">Cost├│ reparar</div>
            <div className="font-bold text-slate-800">{formatCurrency(row.repair_cost)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-slate-500">Ya cobrado</div>
            <div className="font-bold text-slate-800">{formatCurrency(row.charged_to_guest)}</div>
          </div>
          <div className="bg-rose-50 rounded-lg p-2">
            <div className="text-rose-600">Falta</div>
            <div className="font-bold text-rose-700">{formatCurrency(missing)}</div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">Monto recuperado *</label>
            <MoneyInput value={amount} onChange={setAmount} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">┬┐A qu├® cuenta cay├│? *</label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">ÔÇö selecciona ÔÇö</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.bank ? `(${a.bank})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej: Airbnb resoluci├│n #12345"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {amount && amount > 0 && (
            <div className={`rounded-lg p-3 text-xs ${
              profit > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
              profit < 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' :
              'bg-slate-50 text-slate-700 border border-slate-200'
            }`}>
              {profit > 0 && <>Ô£¿ <strong>Ganancia:</strong> +{formatCurrency(profit)} (recibiste m├ís de lo que cost├│)</>}
              {profit < 0 && <>ÔÜá´©Å A├║n faltan {formatCurrency(Math.abs(profit))} por recuperar.</>}
              {profit === 0 && <>Ô£à Quedar├í balanceado exactamente.</>}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'GuardandoÔÇª' : 'Registrar recuperaci├│n'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
