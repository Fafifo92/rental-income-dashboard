import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { updateBookingPayout, updateBookingDeposit } from '@/services/bookings';
import {
  listBookingPayments,
  addBookingPayment,
  deleteBookingPayment,
} from '@/services/bankAccounts';
import {
  listBookingAdjustments,
  updateBookingAdjustment,
} from '@/services/bookingAdjustments';
import type { BankAccountRow, BookingPaymentRow, BookingAdjustmentRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { subMoney } from '@/lib/money';
import { todayISO, formatDateDisplay } from '@/lib/dateUtils';
import MoneyInput from '@/components/MoneyInput';
import { Trash2, Plus, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

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
  /** Deposito de seguridad cobrado al huesped. */
  security_deposit?: number | null;
  deposit_bank_account_id?: string | null;
  deposit_status?: 'none' | 'received' | 'partial_return' | 'returned' | null;
  deposit_returned_amount?: number | null;
  deposit_return_date?: string | null;
}

interface Props {
  booking: PayoutTarget;
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSaved: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d: string | null | undefined) => formatDateDisplay(d);

const DEPOSIT_STATUS_LABELS: Record<string, string> = {
  none: 'No aplica',
  received: 'Recibido (pendiente devolución)',
  partial_return: 'Devolución parcial',
  returned: 'Devuelto al huésped',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BookingPayoutModal({ booking, bankAccounts, onClose, onSaved }: Props) {

  // ── Financial summary (read-only) ─────────────────────────────────────────
  const bruto   = booking.gross_revenue ?? booking.total_revenue ?? 0;
  const feesVal = booking.channel_fees ?? 0;
  const netoVal = booking.net_payout ?? subMoney(bruto, feesVal);
  const isFine  = netoVal < 0;

  // ── Fine (cancelled booking penalty) ─────────────────────────────────────
  const [fineAccount, setFineAccount] = useState(booking.payout_bank_account_id ?? '');
  const [savingFine, setSavingFine]   = useState(false);
  const [fineError, setFineError]     = useState('');

  const handleSaveFineAccount = async () => {
    setSavingFine(true); setFineError('');
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto, channel_fees: feesVal, net_payout: netoVal,
      payout_bank_account_id: fineAccount || null, payout_date: null,
    });
    setSavingFine(false);
    onSaved();
  };

  // ══════════════════════════════════════════════════════════════════════
  // SECTION A — PAGO BASE (total / parcial)
  // ══════════════════════════════════════════════════════════════════════
  const [payments, setPayments]       = useState<BookingPaymentRow[]>([]);
  const [loadingPay, setLoadingPay]   = useState(true);

  // payMode: determined on load from existing payments.
  // 'total'   → single payment flagged as 'Pago total'
  // 'parcial' → 0 or N partial payments (no single total flag)
  // 'locked'  → N > 0 partial payments: mode cannot be switched
  const [payMode, setPayMode] = useState<'total' | 'parcial'>('total');
  const [modeLocked, setModeLocked] = useState(false);

  // Confirm-switch dialog
  const [confirmSwitch, setConfirmSwitch] = useState<'to_total' | 'to_parcial' | null>(null);

  // Total payment fields
  const [totalAmount, setTotalAmount]   = useState<number | null>(netoVal !== 0 ? Math.abs(netoVal) : null);
  const [totalAccount, setTotalAccount] = useState('');
  const [totalDate, setTotalDate]       = useState(booking.start_date ?? todayISO());
  const [savingTotal, setSavingTotal]   = useState(false);
  const [totalError, setTotalError]     = useState('');

  // Partial payment form fields
  const [newAmount, setNewAmount]   = useState<number | null>(null);
  const [newAccount, setNewAccount] = useState('');
  const [newDate, setNewDate]       = useState(booking.start_date ?? todayISO());
  const [newNotes, setNewNotes]     = useState('');
  const [addingPay, setAddingPay]   = useState(false);
  const [payError, setPayError]     = useState('');

  const loadPayments = useCallback(async () => {
    setLoadingPay(true);
    const res = await listBookingPayments(booking.id);
    const data = res.data ?? [];
    setPayments(data);
    if (data.length === 0) {
      setPayMode('total'); setModeLocked(false);
    } else if (data.length === 1 && data[0].notes === 'Pago total') {
      setPayMode('total'); setModeLocked(false);
    } else {
      setPayMode('parcial'); setModeLocked(true);
    }
    setLoadingPay(false);
  }, [booking.id]);

  // ══════════════════════════════════════════════════════════════════════
  // SECTION B — COBROS POR DAÑOS
  // ══════════════════════════════════════════════════════════════════════
  const [damageAdjs, setDamageAdjs]   = useState<BookingAdjustmentRow[]>([]);
  const [savingAdjId, setSavingAdjId] = useState<string | null>(null);
  const [adjAccounts, setAdjAccounts] = useState<Record<string, string>>({});

  const loadAdjustments = useCallback(async () => {
    const res = await listBookingAdjustments(booking.id);
    const damages = (res.data ?? []).filter(a => a.kind === 'damage_charge');
    setDamageAdjs(damages);
    const initial: Record<string, string> = {};
    for (const adj of damages) initial[adj.id] = adj.bank_account_id ?? '';
    setAdjAccounts(initial);
  }, [booking.id]);

  useEffect(() => {
    loadPayments();
    loadAdjustments();
  }, [loadPayments, loadAdjustments]);

  const handleSaveAdjAccount = async (adjId: string) => {
    const accountId = adjAccounts[adjId] ?? '';
    setSavingAdjId(adjId);
    await updateBookingAdjustment(adjId, { bank_account_id: accountId || null });
    setSavingAdjId(null);
    await loadAdjustments();
  };

  const totalDamageReceived = damageAdjs
    .filter(a => a.bank_account_id)
    .reduce((s, a) => s + Number(a.amount), 0);

  // ══════════════════════════════════════════════════════════════════════
  // SECTION C — DEPOSITO DE SEGURIDAD
  // ══════════════════════════════════════════════════════════════════════
  const hasDeposit = (booking.security_deposit ?? 0) > 0;
  const [depositAccount, setDepositAccount] = useState(booking.deposit_bank_account_id ?? '');
  const [depositStatus, setDepositStatus]   = useState<'none'|'received'|'partial_return'|'returned'>(
    (booking.deposit_status as 'none'|'received'|'partial_return'|'returned') ?? 'none',
  );
  const [depositReturnAmt, setDepositReturnAmt] = useState<number | null>(
    booking.deposit_returned_amount != null ? Number(booking.deposit_returned_amount) : null,
  );
  const [depositReturnDate, setDepositReturnDate] = useState(booking.deposit_return_date ?? todayISO());
  const [savingDeposit, setSavingDeposit]   = useState(false);
  const [depositError, setDepositError]     = useState('');
  const [depositSaved, setDepositSaved]     = useState(false);

  const handleSaveDeposit = async () => {
    setSavingDeposit(true); setDepositError(''); setDepositSaved(false);
    if (depositStatus !== 'none' && !depositAccount) {
      setDepositError('Selecciona la cuenta donde se recibió el depósito.');
      setSavingDeposit(false); return;
    }
    if ((depositStatus === 'partial_return' || depositStatus === 'returned') && !depositReturnAmt) {
      setDepositError('Ingresa el monto devuelto.');
      setSavingDeposit(false); return;
    }
    const res = await updateBookingDeposit(booking.id, {
      deposit_bank_account_id: depositAccount || null,
      deposit_status: depositStatus,
      deposit_returned_amount:
        (depositStatus === 'partial_return' || depositStatus === 'returned') ? depositReturnAmt : null,
      deposit_return_date:
        (depositStatus === 'partial_return' || depositStatus === 'returned') ? depositReturnDate : null,
    });
    if (res.error) { setDepositError(res.error); setSavingDeposit(false); return; }
    setSavingDeposit(false); setDepositSaved(true);
    onSaved();
  };

  // ══════════════════════════════════════════════════════════════════════
  // SECTION A — handlers
  // ══════════════════════════════════════════════════════════════════════
  const handleModeSwitch = (mode: 'total' | 'parcial') => {
    if (mode === payMode) return;
    if (modeLocked) return;
    if (payments.length === 0) { setPayMode(mode); return; }
    setConfirmSwitch(mode === 'parcial' ? 'to_parcial' : 'to_total');
  };

  const handleConfirmModeSwitch = async () => {
    if (!confirmSwitch) return;
    if (confirmSwitch === 'to_parcial') {
      const totalPay = payments.find(p => p.notes === 'Pago total');
      if (totalPay) {
        await deleteBookingPayment(totalPay.id);
        await updateBookingPayout(booking.id, { net_payout: null, payout_bank_account_id: null, payout_date: null });
      }
    }
    if (confirmSwitch === 'to_total') {
      for (const p of payments) await deleteBookingPayment(p.id);
      await updateBookingPayout(booking.id, { net_payout: null, payout_bank_account_id: null, payout_date: null });
    }
    setConfirmSwitch(null);
    await loadPayments();
  };

  const handleConfirmTotal = async () => {
    setTotalError('');
    if (!totalAmount || totalAmount <= 0) { setTotalError('El monto debe ser mayor a 0'); return; }
    if (!totalAccount) { setTotalError('Selecciona una cuenta bancaria'); return; }
    const hasPartials = payments.some(p => p.notes !== 'Pago total');
    if (hasPartials) {
      setTotalError('Ya hay pagos parciales. Elimínalos primero o usa el modo Parcial.');
      return;
    }
    const existingTotal = payments.find(p => p.notes === 'Pago total');
    if (existingTotal) await deleteBookingPayment(existingTotal.id);
    setSavingTotal(true);
    const res = await addBookingPayment({
      booking_id: booking.id, amount: totalAmount,
      bank_account_id: totalAccount || null,
      payment_date: totalDate || null, notes: 'Pago total',
    });
    if (res.error) { setTotalError(res.error); setSavingTotal(false); return; }
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto, channel_fees: feesVal, net_payout: totalAmount,
      payout_bank_account_id: totalAccount || null, payout_date: totalDate || null,
    });
    setSavingTotal(false);
    await loadPayments();
    onSaved();
  };

  const handleAddPayment = async () => {
    setPayError('');
    if (!newAmount || newAmount <= 0) { setPayError('El monto debe ser mayor a 0'); return; }
    if (!newAccount) { setPayError('Selecciona una cuenta bancaria'); return; }
    const hasTotalPay = payments.length === 1 && payments[0].notes === 'Pago total';
    if (hasTotalPay) {
      setPayError('Hay un pago total. Cambia a modo Parcial y elimínalo primero.');
      return;
    }
    setAddingPay(true);
    const res = await addBookingPayment({
      booking_id: booking.id, amount: newAmount,
      bank_account_id: newAccount || null,
      payment_date: newDate || null, notes: newNotes || null,
    });
    if (res.error) { setPayError(res.error); setAddingPay(false); return; }
    setNewAmount(null); setNewNotes('');
    await loadPayments();
    const currentPayments = await listBookingPayments(booking.id);
    const newTotal = (currentPayments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto, channel_fees: feesVal, net_payout: newTotal,
      payout_bank_account_id: newAccount || (payments[0]?.bank_account_id ?? null),
      payout_date: newDate || null,
    });
    setAddingPay(false);
  };

  const handleDeletePayment = async (id: string) => {
    const res = await deleteBookingPayment(id);
    if (res.error) return;
    const updated = payments.filter(p => p.id !== id);
    setPayments(updated);
    const newTotal = updated.reduce((s, p) => s + Number(p.amount), 0);
    await updateBookingPayout(booking.id, {
      gross_revenue: bruto, channel_fees: feesVal,
      net_payout: newTotal || null,
      payout_bank_account_id: updated[0]?.bank_account_id ?? null,
      payout_date: updated[0]?.payment_date ?? null,
    });
    if (updated.length === 0) { setPayMode('total'); setModeLocked(false); }
    else if (updated.length === 1 && updated[0].notes === 'Pago total') { setPayMode('total'); setModeLocked(false); }
    else { setModeLocked(true); }
  };

  const totalPaid   = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining   = Math.max(0, subMoney(netoVal, totalPaid));
  const pct         = netoVal > 0 ? Math.min(100, Math.round((totalPaid / netoVal) * 100)) : 0;
  const isFullyPaid = netoVal > 0 && totalPaid >= netoVal;

  // ── Render ────────────────────────────────────────────────────────────────
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

        <div className="p-6 space-y-6">

          {/* ══════════════════ MULTA ══════════════════ */}
          {isFine ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-xl px-5 py-4">
                <div>
                  <p className="text-xs font-semibold text-rose-500 uppercase tracking-wider">Monto descontado</p>
                  <p className="text-2xl font-extrabold text-rose-700 tabular-nums mt-0.5">
                    −{formatCurrency(Math.abs(netoVal))}
                  </p>
                  <p className="text-xs text-rose-500 mt-1">{booking.confirmation_code} · Reserva cancelada</p>
                </div>
                <span className="text-3xl select-none">🚫</span>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">¿De qué cuenta se descontó?</label>
                <select value={fineAccount} onChange={e => setFineAccount(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-400 outline-none bg-white">
                  <option value="">— Selecciona una cuenta —</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{a.bank && !a.is_cash ? ` · ${a.bank}` : ''}</option>
                  ))}
                </select>
                {fineError && <p className="mt-1 text-xs text-rose-600">{fineError}</p>}
              </div>
              <button onClick={handleSaveFineAccount} disabled={savingFine || !fineAccount}
                className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:bg-rose-700 disabled:opacity-50 transition-colors">
                {savingFine ? 'Guardando…' : '✓ Confirmar débito'}
              </button>
            </div>

          ) : (
            <>
              {/* ═══ CHIPS financieros ═══ */}
              <div className="flex gap-3">
                {[
                  { label: 'Bruto', value: bruto, color: 'bg-slate-50 text-slate-700 border-slate-200' },
                  { label: 'Fees', value: feesVal, color: 'bg-amber-50 text-amber-700 border-amber-200' },
                  { label: 'Neto', value: netoVal, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                ].map(chip => (
                  <div key={chip.label} className={`flex-1 rounded-xl border px-3 py-2 text-center ${chip.color}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">{chip.label}</p>
                    <p className="text-sm font-bold mt-0.5">{formatCurrency(Math.abs(chip.value))}</p>
                  </div>
                ))}
              </div>

              {/* ════════════════════════════════════════
                  SECCIÓN A: PAGO BASE
              ════════════════════════════════════════ */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-700">💰 Pago base (plataforma)</h4>
                  {modeLocked && (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
                      Modo parcial · {payments.length} pago{payments.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {!modeLocked && (
                  <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                    {(['total', 'parcial'] as const).map(mode => (
                      <button key={mode}
                        onClick={() => handleModeSwitch(mode)}
                        className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                          payMode === mode ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {mode === 'total' ? 'Pago total' : 'Pago parcial'}
                      </button>
                    ))}
                  </div>
                )}

                {modeLocked && (
                  <button
                    onClick={() => setConfirmSwitch('to_total')}
                    className="w-full text-xs text-slate-500 hover:text-slate-700 border border-dashed border-slate-300 hover:border-slate-400 py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Consolidar como pago total (elimina los parciales)
                  </button>
                )}

                <AnimatePresence>
                  {confirmSwitch && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-amber-800">
                            {confirmSwitch === 'to_parcial' ? 'Cambiar a pagos parciales' : 'Consolidar como pago total'}
                          </p>
                          <p className="text-xs text-amber-700 mt-0.5">
                            {confirmSwitch === 'to_parcial'
                              ? 'Se eliminará el registro de pago total. Podrás ingresar abonos individuales.'
                              : `Se eliminarán los ${payments.length} pago${payments.length !== 1 ? 's' : ''} parciales. Esta acción no puede deshacerse.`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmSwitch(null)}
                          className="flex-1 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                          Cancelar
                        </button>
                        <button onClick={handleConfirmModeSwitch}
                          className="flex-1 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">
                          Confirmar cambio
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {payMode === 'total' ? (
                    <motion.div key="total"
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="space-y-3"
                    >
                      {payments.length === 1 && payments[0].notes === 'Pago total' && (
                        <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <div>
                              <span className="font-semibold text-emerald-800">{formatCurrency(Number(payments[0].amount))}</span>
                              <span className="text-xs text-slate-500 ml-2">
                                {fmtDate(payments[0].payment_date)}
                                {bankAccounts.find(a => a.id === payments[0].bank_account_id)
                                  ? ` · ${bankAccounts.find(a => a.id === payments[0].bank_account_id)!.name}`
                                  : ''}
                              </span>
                            </div>
                          </div>
                          <button onClick={() => handleDeletePayment(payments[0].id)}
                            className="ml-3 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {(payments.length === 0 || (payments.length === 1 && payments[0].notes === 'Pago total')) && (
                        <>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">
                              {payments.length === 1 ? 'Reemplazar monto recibido (COP)' : 'Recibido en banco (COP)'}
                            </label>
                            <MoneyInput value={totalAmount} onChange={setTotalAmount} inputClassName="font-semibold" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta</label>
                              <select value={totalAccount} onChange={e => setTotalAccount(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="">— Selecciona —</option>
                                {bankAccounts.map(a => (
                                  <option key={a.id} value={a.id}>{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}</option>
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
                        </>
                      )}
                    </motion.div>

                  ) : (
                    <motion.div key="parcial"
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="space-y-4"
                    >
                      {netoVal > 0 && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="font-semibold text-slate-700">{formatCurrency(totalPaid)} recibido</span>
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

                      {loadingPay ? (
                        <div className="space-y-2">
                          {[0, 1].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
                        </div>
                      ) : payments.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-1">Sin pagos parciales registrados aún.</p>
                      ) : (
                        <div className="space-y-2">
                          {payments.map(p => {
                            const acct = bankAccounts.find(a => a.id === p.bank_account_id);
                            return (
                              <div key={p.id}
                                className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-sm">
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
                            <option value="">— Selecciona una cuenta —</option>
                            {bankAccounts.map(a => (
                              <option key={a.id} value={a.id}>{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}</option>
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
              </div>

              {/* ════════════════════════════════════════
                  SECCIÓN B: COBROS POR DAÑOS
              ════════════════════════════════════════ */}
              {damageAdjs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-700">⚠️ Cobros por daños</h4>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      totalDamageReceived > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {totalDamageReceived > 0 ? `${formatCurrency(totalDamageReceived)} recibido` : 'Sin cuenta asignada'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 -mt-1">
                    Cuando el dinero llegue a tu cuenta, selecciona dónde ingresó.
                  </p>
                  <div className="space-y-2">
                    {damageAdjs.map(adj => {
                      const isSaving = savingAdjId === adj.id;
                      const hasAccount = !!adj.bank_account_id;
                      const localAccount = adjAccounts[adj.id] ?? '';
                      const isDirty = localAccount !== (adj.bank_account_id ?? '');
                      return (
                        <div key={adj.id}
                          className={`rounded-xl border p-3 space-y-2 ${
                            hasAccount ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className={`text-sm font-semibold ${hasAccount ? 'text-emerald-800' : 'text-rose-800'}`}>
                                {formatCurrency(Number(adj.amount))}
                              </p>
                              <p className="text-[11px] text-slate-600 truncate mt-0.5">
                                {adj.description?.replace(/\[exp:[^\]]+\]/g, '').trim() ?? '—'}
                              </p>
                              <p className="text-[10px] text-slate-400">{fmtDate(adj.date)}</p>
                            </div>
                            {hasAccount && !isDirty && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                            )}
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={localAccount}
                              onChange={e => setAdjAccounts(prev => ({ ...prev, [adj.id]: e.target.value }))}
                              className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                              <option value="">— Cuenta donde llegó el dinero —</option>
                              {bankAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}</option>
                              ))}
                            </select>
                            {isDirty && (
                              <button
                                onClick={() => handleSaveAdjAccount(adj.id)}
                                disabled={isSaving}
                                className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                {isSaving ? '…' : 'Guardar'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {totalDamageReceived > 0 && (
                    <div className="flex justify-between items-center text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <span>Total daños recibidos</span>
                      <span>{formatCurrency(totalDamageReceived)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ════════════════════════════════════════
                  SECCIÓN C: DEPÓSITO DE SEGURIDAD
              ════════════════════════════════════════ */}
              {hasDeposit && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-700">🔐 Depósito de seguridad</h4>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      depositStatus === 'returned' ? 'bg-emerald-100 text-emerald-700'
                      : depositStatus === 'received' ? 'bg-amber-100 text-amber-700'
                      : depositStatus === 'partial_return' ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                    }`}>
                      {DEPOSIT_STATUS_LABELS[depositStatus]}
                    </span>
                  </div>

                  {depositStatus !== 'returned' && (
                    <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-800">
                          {formatCurrency(booking.security_deposit ?? 0)} pendiente de devolución
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Este dinero pertenece al huésped. Debe ser devuelto al finalizar, descontando daños si los hay.
                        </p>
                      </div>
                    </div>
                  )}
                  {depositStatus === 'returned' && (
                    <div className="flex gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-emerald-800">
                        Devuelto al huésped · {formatCurrency(depositReturnAmt ?? 0)}
                        {depositReturnDate ? ` el ${fmtDate(depositReturnDate)}` : ''}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    <span className="text-xs font-semibold text-slate-600">Monto cobrado al huésped</span>
                    <span className="text-base font-bold text-slate-900 tabular-nums">
                      {formatCurrency(booking.security_deposit ?? 0)}
                    </span>
                  </div>

                  {damageAdjs.length > 0 && (
                    <div className="flex items-center justify-between text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                      <span>Daños a descontar del depósito</span>
                      <span className="font-semibold">
                        −{formatCurrency(damageAdjs.reduce((s, a) => s + Number(a.amount), 0))}
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta donde se recibió</label>
                    <select value={depositAccount} onChange={e => setDepositAccount(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">— Selecciona una cuenta —</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}{a.bank && !a.is_cash ? ` (${a.bank})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Estado del depósito</label>
                    <select value={depositStatus}
                      onChange={e => setDepositStatus(e.target.value as typeof depositStatus)}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="none">No aplica</option>
                      <option value="received">Recibido (pendiente devolución)</option>
                      <option value="partial_return">Devolución parcial (daño descontado)</option>
                      <option value="returned">Devuelto al huésped</option>
                    </select>
                  </div>

                  <AnimatePresence>
                    {(depositStatus === 'partial_return' || depositStatus === 'returned') && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="grid grid-cols-2 gap-3"
                      >
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Monto devuelto (COP)</label>
                          <MoneyInput value={depositReturnAmt} onChange={setDepositReturnAmt} inputClassName="text-blue-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha devolución</label>
                          <input type="date" value={depositReturnDate}
                            onChange={e => setDepositReturnDate(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {depositError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{depositError}</p>
                  )}
                  {depositSaved && (
                    <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Depósito actualizado correctamente.
                    </p>
                  )}
                  <button onClick={handleSaveDeposit} disabled={savingDeposit}
                    className="w-full py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50">
                    {savingDeposit ? 'Guardando…' : '✓ Guardar depósito'}
                  </button>
                </div>
              )}
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
