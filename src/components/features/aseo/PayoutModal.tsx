'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import type { computeCleanerBalances } from '@/services/cleanings';
import type { Vendor } from '@/services/vendors';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { todayISO } from '@/lib/dateUtils';

type BalanceEntry = ReturnType<typeof computeCleanerBalances> extends Map<string, infer V> ? V | undefined : never;

interface Props {
  cleaner: Vendor;
  balance: BalanceEntry;
  looseAmount: number;
  looseCount: number;
  banks: BankAccountRow[];
  onClose: () => void;
  onConfirm: (args: { paidDate: string; bankAccountId: string; includePending: boolean }) => Promise<string | null>;
}

export default function PayoutModal({
  cleaner, balance, looseAmount, looseCount, banks, onClose, onConfirm,
}: Props) {
  const backdrop = useBackdropClose(onClose);
  const [paidDate, setPaidDate] = useState(todayISO());
  const [bankId, setBankId] = useState<string>('');
  const [includePending, setIncludePending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaningAmount = (balance?.done_unpaid_amount ?? 0) + (includePending ? (balance?.pending_amount ?? 0) : 0);
  const cleaningCount = (balance?.done_unpaid_count ?? 0) + (includePending ? (balance?.pending_count ?? 0) : 0);
  const amount = cleaningAmount + looseAmount;
  const count = cleaningCount;

  const submit = async () => {
    if (!bankId) {
      setError('Selecciona la cuenta bancaria desde la que se realizó el pago.');
      return;
    }
    setWorking(true);
    setError(null);
    const err = await onConfirm({ paidDate, bankAccountId: bankId, includePending });
    setWorking(false);
    if (err) setError(err);
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b">
          <h3 className="text-xl font-bold text-slate-800">💸 Liquidar a {cleaner.name}</h3>
          <p className="text-xs text-slate-500 mt-1">Crea un gasto por reserva (aseo + insumos por separado) y los marca como pagados.</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-xs text-emerald-700 font-semibold uppercase tracking-wide">A pagar ahora</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(amount)}</div>
            <div className="text-xs text-emerald-700/80 mt-1 space-y-0.5">
              <div>🧹 Aseos: {formatCurrency(cleaningAmount)} ({count} aseo{count === 1 ? '' : 's'})</div>
              {looseCount > 0 && (
                <div>🧴 Insumos sueltos: {formatCurrency(looseAmount)} ({looseCount} compra{looseCount === 1 ? '' : 's'})</div>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includePending}
              onChange={e => setIncludePending(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Incluir aseos <strong>pendientes</strong> ({balance?.pending_count ?? 0} · {formatCurrency(balance?.pending_amount ?? 0)})
              <div className="text-xs text-slate-500">Normalmente solo se paga lo ya hecho. Actívalo si vas a pagar por adelantado.</div>
            </span>
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de pago</label>
            <input
              type="date"
              value={paidDate}
              onChange={e => setPaidDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Cuenta bancaria <span className="text-red-500">*</span>
            </label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">— Sin especificar —</option>
              {banks.map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.bank ? ` · ${b.bank}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
            Por cada aseo se creará un gasto independiente <strong>&quot;Aseo – {'{propiedad}'} · Reserva {'{código}'}&quot;</strong>{' '}
            con categoría <code className="bg-white px-1 rounded">cleaning</code> y status{' '}
            <code className="bg-white px-1 rounded">paid</code>. Si el aseo tenía insumos reembolsables se generará{' '}
            <strong>otro gasto separado</strong> <em>&quot;Insumos de aseo – {'{propiedad}'} · Reserva {'{código}'}&quot;</em>.
            {looseCount > 0 && (
              <> Las <strong>{looseCount} compras de insumos sueltas</strong> ya registradas a nombre de esta persona se marcarán como pagadas y se unirán al mismo grupo de liquidación.</>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={working || amount === 0 || !bankId}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {working ? 'Procesando…' : `Pagar ${formatCurrency(amount)}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
