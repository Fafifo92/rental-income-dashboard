import { useState } from 'react';
import { motion } from 'framer-motion';
import { updateBookingPayout } from '@/services/bookings';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { subMoney } from '@/lib/money';
import MoneyInput from '@/components/MoneyInput';

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
  // Bloque 10: contexto para validar payout
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
  const [gross, setGross] = useState<number | null>(booking.gross_revenue ?? booking.total_revenue ?? null);
  const [fees, setFees] = useState<number | null>(booking.channel_fees ?? null);
  const [net, setNet] = useState<number | null>(booking.net_payout ?? null);
  const [bankAccountId, setBankAccountId] = useState(booking.payout_bank_account_id ?? '');
  const [payoutDate, setPayoutDate] = useState(booking.payout_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Sincronización bidireccional bruto / fees / neto usando aritmética en centavos.
  const handleGrossChange = (v: number | null) => {
    setGross(v);
    if (v !== null && fees !== null) setNet(Math.max(0, subMoney(v, fees)));
  };
  const handleFeesChange = (v: number | null) => {
    setFees(v);
    if (gross !== null && v !== null) setNet(Math.max(0, subMoney(gross, v)));
  };
  const handleNetChange = (v: number | null) => {
    setNet(v);
    if (gross !== null && v !== null) setFees(Math.max(0, subMoney(gross, v)));
  };
  const suggestNet = () => {
    if (gross !== null) setNet(Math.max(0, subMoney(gross, fees ?? 0)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    // Bloque 10: bloquear payout de reservas futuras no-directas sin checkin
    const isDirect = (booking.channel ?? '').toLowerCase() === 'direct';
    const today = new Date().toISOString().slice(0, 10);
    const isFuture = booking.start_date ? booking.start_date > today : false;
    if (!isDirect && isFuture && !booking.checkin_done) {
      setSaving(false);
      setError(
        'No se puede liquidar payout: la reserva es futura y no es de cliente directo. ' +
        'Las plataformas pagan después del check-in. Espera a que el huésped haga check-in.'
      );
      return;
    }

    const res = await updateBookingPayout(booking.id, {
      gross_revenue: gross,
      channel_fees: fees ?? 0,
      net_payout: net,
      payout_bank_account_id: bankAccountId || null,
      payout_date: payoutDate || null,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  const diff = gross !== null && net !== null ? subMoney(gross, net) : null;

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
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Payout real</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {booking.confirmation_code} · {booking.guest_name}
            </p>
          </div>
          <button onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            Airbnb te muestra un monto, pero al banco llega otro (comisiones, retenciones, conversión).
            Registra aquí el valor real que llegó a tu cuenta.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bruto (reserva) COP</label>
              <MoneyInput value={gross} onChange={handleGrossChange} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Comisiones / Fees</label>
              <MoneyInput value={fees} onChange={handleFeesChange} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600">Neto recibido al banco *</label>
              <button type="button" onClick={suggestNet}
                className="text-xs text-blue-600 hover:underline">Sugerir (bruto − fees)</button>
            </div>
            <MoneyInput
              value={net}
              onChange={handleNetChange}
              inputClassName="font-semibold focus:ring-emerald-500"
            />
            {diff !== null && diff !== 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Diferencia con bruto: {formatCurrency(diff)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta bancaria</label>
              <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="">— Sin asignar —</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.bank ? ` (${a.bank})` : ''}</option>
                ))}
              </select>
              {bankAccounts.length === 0 && (
                <a href="/accounts" className="block mt-1 text-xs text-blue-600 hover:underline">
                  + Crear cuenta bancaria
                </a>
              )}
              {bankAccounts.length > 0 && !bankAccountId && (
                <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  ⚠️ Sin cuenta: el dinero quedará "volando". Podrás asignarlo después en /accounts.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha del depósito</label>
              <input type="date" value={payoutDate} onChange={e => setPayoutDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-60">
            {saving ? 'Guardando…' : 'Guardar payout'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
