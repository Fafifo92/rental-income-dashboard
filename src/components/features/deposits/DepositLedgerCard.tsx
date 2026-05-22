'use client';
/**
 * Tarjeta "Depósitos de huéspedes" — vista virtual (ledger).
 *
 * NO es una cuenta bancaria real: el dinero vive en las cuentas reales
 * (`bookings.deposit_bank_account_id`). Esta tarjeta agrega y muestra el
 * historial de depósitos retenidos / aplicados / devueltos / convertidos
 * SIN afectar el P&L del negocio.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, X } from 'lucide-react';
import { getDepositsSummary, type DepositsGlobalSummary } from '@/services/deposits';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

const STATUS_TONE: Record<string, string> = {
  none: 'bg-slate-100 text-slate-500',
  received: 'bg-amber-100 text-amber-700',
  partial_return: 'bg-blue-100 text-blue-700',
  returned: 'bg-emerald-100 text-emerald-700',
  applied_to_damage: 'bg-rose-100 text-rose-700',
  mixed: 'bg-violet-100 text-violet-700',
};

const STATUS_LABEL: Record<string, string> = {
  none: 'Sin depósito',
  received: 'Recibido',
  partial_return: 'Devolución parcial',
  returned: 'Devuelto',
  applied_to_damage: 'Aplicado a daños',
  mixed: 'Mixto',
};

interface Props {
  /** Mapa id → name de cuentas bancarias para mostrar dónde está cada depósito. */
  accountsMap?: Record<string, string>;
}

export default function DepositLedgerCard({ accountsMap = {} }: Props) {
  const [summary, setSummary] = useState<DepositsGlobalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const backdrop = makeBackdropHandlers(() => setOpen(false));

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await getDepositsSummary();
      if (active && res.data) setSummary(res.data);
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const totalHeld = summary?.total_held ?? 0;
  const activeRows = (summary?.rows ?? []).filter(r => r.balance.available > 0 || r.balance.applied_amount > 0);

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        whileHover={{ y: -2 }}
        className="text-left bg-white border-2 border-dashed border-amber-300 rounded-2xl p-5 shadow-sm hover:border-amber-400 transition-colors"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-amber-100 grid place-items-center">
            <Coins className="w-5 h-5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 truncate">Depósitos de huéspedes</h3>
            <p className="text-[11px] text-slate-500">Vista virtual · no afecta P&amp;L</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-amber-100">
          <p className="text-xs uppercase tracking-wider text-amber-700">Saldo retenido</p>
          <p className="text-2xl font-extrabold text-amber-800 mt-1">
            {loading ? '—' : formatCurrency(totalHeld)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {activeRows.length} reserva(s) con depósito activo
          </p>
        </div>
      </motion.button>

      <AnimatePresence>
        {open && summary && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
            {...backdrop}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Coins className="w-5 h-5 text-amber-700" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Depósitos de huéspedes</h3>
                    <p className="text-[11px] text-slate-500">
                      Esta vista es de control. El dinero real vive en las cuentas bancarias seleccionadas en cada reserva.
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded">
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-5 gap-2 bg-slate-50 border-b">
                <Metric label="Retenido" value={summary.total_held} tone="amber" />
                <Metric label="Cobrado" value={summary.total_received} tone="slate" />
                <Metric label="Devuelto" value={summary.total_returned} tone="emerald" />
                <Metric label="A daños" value={summary.total_applied_to_damage} tone="rose" />
                <Metric label="A ingreso" value={summary.total_surplus_to_income} tone="indigo" />
              </div>

              <div className="overflow-y-auto flex-1 px-6 py-4">
                {summary.rows.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No hay reservas con depósito de seguridad.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {summary.rows.map(({ booking, balance }) => (
                      <li key={booking.id} className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">
                              {booking.guest_name ?? '—'}
                              <span className="text-slate-400 font-normal text-xs ml-2">
                                {booking.confirmation_code}
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {booking.start_date ? formatDateDisplay(booking.start_date) : '—'}
                              {' → '}
                              {booking.end_date ? formatDateDisplay(booking.end_date) : '—'}
                              {booking.deposit_bank_account_id && accountsMap[booking.deposit_bank_account_id] && (
                                <> · en <strong>{accountsMap[booking.deposit_bank_account_id]}</strong></>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 text-right">
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-slate-400">Retenido</p>
                              <p className="text-sm font-bold text-amber-700 tabular-nums">
                                {formatCurrency(balance.available)}
                              </p>
                            </div>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_TONE[booking.deposit_status ?? 'none']}`}>
                              {STATUS_LABEL[booking.deposit_status ?? 'none']}
                            </span>
                          </div>
                        </div>
                        {(balance.applied_amount > 0 || balance.returned_amount > 0 || balance.surplus_amount > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                            {balance.applied_amount > 0 && (
                              <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                                🔧 {formatCurrency(balance.applied_amount)}
                              </span>
                            )}
                            {balance.returned_amount > 0 && (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                ↩️ {formatCurrency(balance.returned_amount)}
                              </span>
                            )}
                            {balance.surplus_amount > 0 && (
                              <span className="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                💰 {formatCurrency(balance.surplus_amount)}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const TONE_CLS: Record<string, string> = {
  amber: 'text-amber-700',
  slate: 'text-slate-700',
  emerald: 'text-emerald-700',
  rose: 'text-rose-700',
  indigo: 'text-indigo-700',
};

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${TONE_CLS[tone] ?? 'text-slate-700'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
