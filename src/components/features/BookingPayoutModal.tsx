import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { updateBookingPayout } from '@/services/bookings';
import {
  listBookingPayments,
  addBookingPayment,
  deleteBookingPayment,
} from '@/services/bankAccounts';
import type { BankAccountRow, BookingPaymentRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { subMoney } from '@/lib/money';
import { todayISO } from '@/lib/dateUtils';
import MoneyInput from '@/components/MoneyInput';
import { Trash2, Plus } from 'lucide-react';

export interface PayoutTarget {
  id: string;
  confirmation_code: string;
  guest_name: string;
  total_revenue: number;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_bank_account_id?: string | null;
  payout_date?: string | null;
  channel?: string | null;
  start_date?: string | null;
  checkin_done?: boolean | null;
}

interface Props {
  booking: PayoutTarget;
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSaved: () => void;
}

export default function BookingPayoutModal({ booking, bankAccounts, onClose, onSaved }: Props) {
  // ── Computed read-only financial summary ──────────────────────────────────
  // For cancelled bookings with negative revenue, bruto/neto are negative (host was fined).
  const bruto   = booking.gross_revenue ?? booking.total_revenue ?? 0;
  const feesVal = booking.channel_fees ?? 0;
  // Preserve the actual sign — don't clamp to 0
  const netoVal = booking.net_payout ?? subMoney(bruto, feesVal);
  const isFine  = netoVal < 0; // deduction, no payment to receive
  // ── Fine debit account ────────────────────────────────────────────────────
  const [fineAccount, setFineAccount] = useState(booking.payout_bank_account_id ?? '');
  const [savingFine, setSavingFine]   = useState(false);
  const [fineError, setFineError]     = useState('');

  const handleSaveFineAccount = async () => {
    setSavingFine(true);
    setFineError('');
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto,
      channel_fees: feesVal,
      net_payout: netoVal,
      payout_bank_account_id: fineAccount || null,
      payout_date: null,
    });
    setSavingFine(false);
    onSaved();
  };
  // ── Mode toggle ───────────────────────────────────────────────────────────
  const [payType, setPayType] = useState<'total' | 'parcial'>('total');

  // ── Total payment fields ──────────────────────────────────────────────────
  const [totalAmount, setTotalAmount]   = useState<number | null>(netoVal !== 0 ? Math.abs(netoVal) : null);
  const [totalAccount, setTotalAccount] = useState('');
  const [totalDate, setTotalDate]       = useState(todayISO());
  const [savingTotal, setSavingTotal]   = useState(false);
  const [totalError, setTotalError]     = useState('');

  // ── Partial payments ──────────────────────────────────────────────────────
  const [payments, setPayments]     = useState<BookingPaymentRow[]>([]);
  const [loadingPay, setLoadingPay] = useState(true);
  const [newAmount, setNewAmount]   = useState<number | null>(null);
  const [newAccount, setNewAccount] = useState('');
  const [newDate, setNewDate]       = useState(todayISO());
  const [newNotes, setNewNotes]     = useState('');
  const [addingPay, setAddingPay]   = useState(false);
  const [payError, setPayError]     = useState('');

  const loadPayments = useCallback(async () => {
    setLoadingPay(true);
    const res = await listBookingPayments(booking.id);
    const data = res.data ?? [];
    setPayments(data);
    // If payments already exist, default to parcial mode
    if (data.length > 0) setPayType('parcial');
    setLoadingPay(false);
  }, [booking.id]);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  // ── Total payment confirm ─────────────────────────────────────────────────
  const handleConfirmTotal = async () => {
    if (!totalAmount || totalAmount <= 0) {
      setTotalError('El monto debe ser mayor a 0');
      return;
    }
    setSavingTotal(true);
    setTotalError('');
    const res = await addBookingPayment({
      booking_id: booking.id,
      amount: totalAmount,
      bank_account_id: totalAccount || null,
      payment_date: totalDate || null,
      notes: 'Pago total',
    });
    if (res.error) {
      setTotalError(res.error);
      setSavingTotal(false);
      return;
    }
    // Keep legacy fields in sync
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto,
      channel_fees: feesVal,
      net_payout: totalAmount,
      payout_bank_account_id: totalAccount || null,
      payout_date: totalDate || null,
    });
    setSavingTotal(false);
    onSaved();
  };

  // ── Partial: add payment ──────────────────────────────────────────────────
  const handleAddPayment = async () => {
    if (!newAmount || newAmount <= 0) { setPayError('El monto debe ser mayor a 0'); return; }
    setAddingPay(true);
    setPayError('');
    const res = await addBookingPayment({
      booking_id: booking.id,
      amount: newAmount,
      bank_account_id: newAccount || null,
      payment_date: newDate || null,
      notes: newNotes || null,
    });
    setAddingPay(false);
    if (res.error) { setPayError(res.error); return; }
    setNewAmount(null);
    setNewNotes('');
    await loadPayments();
    // Sync legacy net_payout to total of all payments
    const newTotal = [...payments, res.data!].reduce((s, p) => s + Number(p.amount), 0);
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto,
      channel_fees: feesVal,
      net_payout: newTotal,
      payout_bank_account_id: newAccount || (payments[0]?.bank_account_id ?? null),
      payout_date: newDate || null,
    });
  };

  const handleDeletePayment = async (id: string) => {
    const res = await deleteBookingPayment(id);
    if (res.error) return;
    const updated = payments.filter(p => p.id !== id);
    setPayments(updated);
    const newTotal = updated.reduce((s, p) => s + Number(p.amount), 0);
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto,
      channel_fees: feesVal,
      net_payout: newTotal || null,
      payout_bank_account_id: updated[0]?.bank_account_id ?? null,
      payout_date: updated[0]?.payment_date ?? null,
    });
  };

  const totalPaid   = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining   = Math.max(0, subMoney(netoVal, totalPaid));
  const pct         = netoVal > 0 ? Math.min(100, Math.round((totalPaid / netoVal) * 100)) : 0;
  const isFullyPaid = netoVal > 0 && totalPaid >= netoVal;

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y.slice(2)}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {isFine ? 'Multa por cancelación' : 'Payout de reserva'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {booking.confirmation_code} · {booking.guest_name}
            </p>
          </div>
          <button onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-5">

          {/* ══════════════════════════════════════════════
              CASO MULTA: solo monto + cuenta de débito
          ══════════════════════════════════════════════ */}
          {isFine ? (
            <div className="space-y-5">
              {/* Monto descontado */}
              <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-xl px-5 py-4">
                <div>
                  <p className="text-xs font-semibold text-rose-500 uppercase tracking-wider">Monto descontado</p>
                  <p className="text-2xl font-extrabold text-rose-700 tabular-nums mt-0.5">
                    −{formatCurrency(Math.abs(netoVal))}
                  </p>
                  <p className="text-xs text-rose-500 mt-1">
                    {booking.confirmation_code} · Reserva cancelada
                  </p>
                </div>
                <span className="text-3xl select-none">⚠️</span>
              </div>

              {/* Selector de cuenta */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ¿De qué cuenta se descontó?
                </label>
                <select
                  value={fineAccount}
                  onChange={e => setFineAccount(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-400 outline-none bg-white"
                >
                  <option value="">— Selecciona una cuenta —</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.is_cash ? '💵 ' : ''}{a.name}{a.bank && !a.is_cash ? ` · ${a.bank}` : ''}
                    </option>
                  ))}
                </select>
                {fineError && <p className="mt-1 text-xs text-rose-600">{fineError}</p>}
              </div>

              <button
                onClick={handleSaveFineAccount}
                disabled={savingFine || !fineAccount}
                className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {savingFine ? 'Guardando…' : '✓ Confirmar débito'}
              </button>
            </div>

          ) : (
            <>
          {/* ── Info chips (read-only) ── */}
          <div className="flex gap-3">
            {[
              { label: 'Bruto', value: bruto, color: 'bg-slate-50 text-slate-700 border-slate-200' },
              { label: 'Fees', value: feesVal, color: 'bg-amber-50 text-amber-700 border-amber-200' },
              { label: 'Neto', value: netoVal, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            ].map(chip => (
              <div key={chip.label}
                className={`flex-1 rounded-xl border px-3 py-2 text-center ${chip.color}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">{chip.label}</p>
                <p className="text-sm font-bold mt-0.5">{formatCurrency(Math.abs(chip.value))}</p>
              </div>
            ))}
          </div>
          {/* ── Toggle Total / Parcial ── */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {(['total', 'parcial'] as const).map(mode => (
              <button key={mode}
                onClick={() => setPayType(mode)}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  payType === mode
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}>
                {mode === 'total' ? 'Pago total' : 'Pago parcial'}
              </button>
            ))}
          </div>

          {/* ── Total mode ── */}
          <AnimatePresence mode="wait">
            {payType === 'total' ? (
              <motion.div key="total"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Recibido en banco (COP)</label>
                  <MoneyInput value={totalAmount} onChange={setTotalAmount} inputClassName="font-semibold" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta</label>
                    <select value={totalAccount} onChange={e => setTotalAccount(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">— Sin asignar —</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.is_cash ? '💵 ' : ''}{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha</label>
                    <input type="date" value={totalDate} onChange={e => setTotalDate(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                {totalError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{totalError}</p>
                )}
                <button onClick={handleConfirmTotal} disabled={savingTotal || !totalAmount}
                  className="w-full py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50">
                  {savingTotal ? 'Confirmando…' : '✓ Confirmar ingreso'}
                </button>
              </motion.div>
            ) : (
              /* ── Parcial mode ── */
              <motion.div key="parcial"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="space-y-4"
              >
                {/* Progress bar */}
                {netoVal > 0 && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(totalPaid)} recibido
                      </span>
                      <span className={isFullyPaid ? 'text-emerald-600 font-bold' : 'text-slate-500'}>
                        {isFullyPaid ? '✓ Recibido completamente' : `Por recibir: ${formatCurrency(remaining)}`}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isFullyPaid ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">{pct}% de {formatCurrency(netoVal)}</p>
                  </div>
                )}

                {/* Payment list */}
                {loadingPay ? (
                  <div className="space-y-2">
                    {[0,1].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
                  </div>
                ) : payments.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-1">Sin pagos parciales registrados aún.</p>
                ) : (
                  <div className="space-y-2">
                    {payments.map(p => {
                      const acct = bankAccounts.find(a => a.id === p.bank_account_id);
                      return (
                        <div key={p.id}
                          className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-sm"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-emerald-800">{formatCurrency(Number(p.amount))}</span>
                            <span className="text-xs text-slate-500 truncate">
                              {fmtDate(p.payment_date)}{acct ? ` · ${acct.name}` : ''}{p.notes ? ` · ${p.notes}` : ''}
                            </span>
                          </div>
                          <button onClick={() => handleDeletePayment(p.id)}
                            className="ml-3 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add payment form */}
                <div className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-600">Agregar pago</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Monto *</label>
                      <MoneyInput value={newAmount} onChange={setNewAmount} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Fecha</label>
                      <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Cuenta / forma de pago</label>
                    <select value={newAccount} onChange={e => setNewAccount(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">— Sin asignar —</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.is_cash ? '💵 ' : ''}{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Nota (opcional)</label>
                    <input type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)}
                      placeholder="Ej: cuota inicial, abono…"
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  {payError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{payError}</p>
                  )}
                  <button onClick={handleAddPayment} disabled={addingPay || !newAmount}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                    <Plus className="w-4 h-4" />
                    {addingPay ? 'Agregando…' : 'Agregar pago'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
            </>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
