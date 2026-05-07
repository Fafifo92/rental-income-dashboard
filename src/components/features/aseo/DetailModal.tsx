'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import {
  listCleaningsByCleaner,
  listCleanerLooseSupplies,
  type BookingCleaning,
  type CleaningHistoryRow,
  type LooseSupplyRow,
} from '@/services/cleanings';
import type { Vendor } from '@/services/vendors';
import { formatCurrency } from '@/lib/utils';

interface Props {
  cleaner: Vendor;
  /** @deprecated Not used internally — DetailModal loads its own data. */
  cleanings?: BookingCleaning[];
  onClose: () => void;
}

export default function DetailModal({ cleaner, onClose }: Props) {
  const backdrop = useBackdropClose(onClose);
  const [rows, setRows] = useState<CleaningHistoryRow[]>([]);
  const [loose, setLoose] = useState<LooseSupplyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      listCleaningsByCleaner(cleaner.id),
      listCleanerLooseSupplies(cleaner.id),
    ]).then(([res, lRes]) => {
      if (!mounted) return;
      setRows(res.data ?? []);
      setLoose(lRes.data ?? []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cleaner.id]);

  const totalEarned = rows.reduce((s, r) => s + r.fee, 0);
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.fee, 0);
  const totalUnpaid = rows.filter(r => r.status !== 'paid').reduce((s, r) => s + r.fee, 0);
  const totalSuppliesReimb = rows.reduce((s, r) => s + (r.reimburse_to_cleaner ? r.supplies_amount : 0), 0);
  const totalLoosePending = loose.filter(l => l.status === 'pending').reduce((s, l) => s + l.amount, 0);
  const totalLoosePaid = loose.filter(l => l.status === 'paid').reduce((s, l) => s + l.amount, 0);

  const sourceBadge = (s: string | null): string => {
    if (!s) return '—';
    const v = s.toLowerCase();
    if (v.includes('airbnb')) return 'Airbnb';
    if (v.includes('booking')) return 'Booking';
    if (v.includes('direct') || v.includes('directa')) return 'Directa';
    return s;
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-800">🧹 {cleaner.name}</h3>
            <p className="text-sm text-slate-500">Historial de aseos ({rows.length})</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-center text-xs items-start">
            <div className="bg-slate-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-slate-500 font-semibold">Total facturado</div>
              <div className="text-base font-bold text-slate-800">{formatCurrency(totalEarned)}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-emerald-600 font-semibold">Pagado</div>
              <div className="text-base font-bold text-emerald-700">{formatCurrency(totalPaid)}</div>
            </div>
            <div className="bg-amber-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-amber-600 font-semibold">Sin pagar</div>
              <div className="text-base font-bold text-amber-700">{formatCurrency(totalUnpaid)}</div>
            </div>
            <div className="bg-indigo-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-indigo-600 font-semibold">Insumos reemb.</div>
              <div className="text-base font-bold text-indigo-700">{formatCurrency(totalSuppliesReimb)}</div>
            </div>
            <div className="bg-cyan-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center" title="Insumos comprados por la persona, sin asignar a una reserva">
              <div className="text-[10px] uppercase text-cyan-600 font-semibold">Insumos sueltos</div>
              <div className="text-base font-bold text-cyan-700">{formatCurrency(totalLoosePending)}</div>
              <div className="text-[10px] text-cyan-600">pend · pagado: {formatCurrency(totalLoosePaid)}</div>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-8">Cargando historial…</p>
          ) : (
            <>
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  🧹 Aseos hechos por reserva
                  <span className="text-[10px] text-slate-400 font-normal">({rows.length})</span>
                </h4>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 bg-slate-50 rounded-lg text-center">Aún no hay aseos registrados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                        <tr>
                          <th className="text-left py-2 px-2">Estado</th>
                          <th className="text-left py-2 px-2">Propiedad</th>
                          <th className="text-left py-2 px-2">Reserva</th>
                          <th className="text-left py-2 px-2">Huésped</th>
                          <th className="text-left py-2 px-2">Fecha aseo</th>
                          <th className="text-left py-2 px-2">Pagado</th>
                          <th className="text-right py-2 px-2">Tarifa</th>
                          <th className="text-right py-2 px-2">Insumos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(r => (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="py-2 px-2">
                              {r.status === 'paid' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Pagado</span>}
                              {r.status === 'done' && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Hecho</span>}
                              {r.status === 'pending' && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Pendiente</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-700 font-medium">{r.property_name ?? '—'}</td>
                            <td className="py-2 px-2">
                              {r.booking_id ? (
                                <a
                                  href={`/bookings?focus=${r.booking_id}`}
                                  className="text-blue-600 hover:underline text-xs font-mono"
                                  title="Abrir reserva"
                                >
                                  {r.booking_code ?? r.booking_id.slice(0, 8)}
                                </a>
                              ) : '—'}
                              {r.listing_source && (
                                <span className="ml-1.5 text-[10px] text-slate-400">· {sourceBadge(r.listing_source)}</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-slate-600 truncate max-w-[180px]" title={r.guest_name ?? undefined}>
                              {r.guest_name ?? '—'}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{r.done_date ?? r.check_out ?? '—'}</td>
                            <td className="py-2 px-2 text-slate-500">{r.paid_date ?? '—'}</td>
                            <td className="py-2 px-2 text-right font-semibold">{formatCurrency(r.fee)}</td>
                            <td className="py-2 px-2 text-right">
                              {r.supplies_amount > 0 ? (
                                <span
                                  className={r.reimburse_to_cleaner ? 'text-indigo-700 font-semibold' : 'text-slate-400'}
                                  title={r.reimburse_to_cleaner ? 'Insumos reembolsados al cleaner en la liquidación' : 'Insumos NO reembolsados al cleaner'}
                                >
                                  {formatCurrency(r.supplies_amount)}
                                  {!r.reimburse_to_cleaner && <span className="ml-1 text-[10px]">(no reemb.)</span>}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  🧴 Insumos comprados por la persona
                  <span className="text-[10px] text-slate-400 font-normal">({loose.length})</span>
                  {totalLoosePending > 0 && (
                    <span className="ml-auto text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                      Por liquidar: {formatCurrency(totalLoosePending)}
                    </span>
                  )}
                </h4>
                {loose.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3 bg-slate-50 rounded-lg text-center">
                    No hay compras de insumos registradas a nombre de esta persona.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                        <tr>
                          <th className="text-left py-2 px-2">Estado</th>
                          <th className="text-left py-2 px-2">Fecha</th>
                          <th className="text-left py-2 px-2">Propiedad</th>
                          <th className="text-left py-2 px-2">Detalle</th>
                          <th className="text-left py-2 px-2">Pagado</th>
                          <th className="text-right py-2 px-2">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loose.map(l => (
                          <tr key={l.id} className="hover:bg-slate-50">
                            <td className="py-2 px-2">
                              {l.status === 'paid'
                                ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Liquidado</span>
                                : <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Por liquidar</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{l.date}</td>
                            <td className="py-2 px-2 text-slate-700">{l.property_name ?? <span className="text-slate-400">—</span>}</td>
                            <td className="py-2 px-2 text-slate-600 truncate max-w-[260px]" title={l.description ?? undefined}>
                              {l.description ?? <span className="text-slate-400">Sin detalle</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{l.paid_date ?? '—'}</td>
                            <td className="py-2 px-2 text-right font-semibold text-cyan-700">{formatCurrency(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
