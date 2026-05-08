import { useState, useEffect } from 'react';
import { getDamageReconciliations, type DamageReconciliation } from '@/services/inventory';
import { formatCurrency } from '@/lib/utils';

export default function BookingDamagesSection({ bookingId }: { bookingId: string }): JSX.Element | null {
  const [rows, setRows] = useState<DamageReconciliation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getDamageReconciliations().then(res => {
      if (!mounted) return;
      const filtered = (res.data ?? []).filter(r => r.booking_id === bookingId);
      setRows(filtered);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [bookingId]);

  if (loading || rows.length === 0) return null;

  const totalCost = rows.reduce((s, r) => s + r.repair_cost, 0);
  const totalCharged = rows.reduce((s, r) => s + r.charged_to_guest, 0);
  const netDiff = totalCharged - totalCost;

  return (
    <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-4 mt-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-rose-800 flex items-center gap-1.5">Daños del inventario ({rows.length})</h3>
          <p className="text-[11px] text-rose-700/80">Items reportados como dañados durante esta reserva.</p>
        </div>
        <div className="text-right text-xs">
          <div className="text-slate-500">Costo {formatCurrency(totalCost)} · Cobrado {formatCurrency(totalCharged)}</div>
          <div className={`font-bold ${netDiff < 0 ? 'text-rose-700' : netDiff > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
            Neto: {netDiff < 0 ? '−' : netDiff > 0 ? '+' : ''}{formatCurrency(Math.abs(netDiff))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-500 bg-white/60">
            <tr>
              <th className="text-left py-1.5 px-2">Item</th>
              <th className="text-right py-1.5 px-2">Costo</th>
              <th className="text-right py-1.5 px-2">Cobrado</th>
              <th className="text-right py-1.5 px-2">Diff</th>
              <th className="text-left py-1.5 px-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rose-100">
            {rows.map(r => (
              <tr key={r.movement_id}>
                <td className="py-1.5 px-2 font-medium text-slate-800">{r.item_name}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(r.repair_cost)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(r.charged_to_guest)}</td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${
                  r.diff < 0 ? 'text-rose-700' : r.diff > 0 ? 'text-emerald-700' : 'text-slate-500'
                }`}>
                  {r.diff < 0 ? '−' : r.diff > 0 ? '+' : ''}{formatCurrency(Math.abs(r.diff))}
                </td>
                <td className="py-1.5 px-2">
                  {r.status === 'balanced' && <span className="text-emerald-700">✓ Balanceado</span>}
                  {r.status === 'pending_recovery' && <span className="text-rose-700">Falta recuperar</span>}
                  {r.status === 'overpaid' && <span className="text-emerald-700">Sobrante</span>}
                  {r.status === 'no_charge' && <span className="text-slate-600">Sin cobro</span>}
                  {r.status === 'pending_repair' && <span className="text-amber-700">Pago pendiente</span>}
                  {!r.is_repaired && r.expense_status === 'paid' && (
                    <span className="ml-1.5 text-[10px] text-slate-400">· item dañado</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
