/**
 * CreditPoolAttributionPanel.tsx
 *
 * Muestra la atribución INFORMATIVA del costo de bolsas de créditos por
 * propiedad, en un rango de fechas (basado en `occurred_at` de cada consumo).
 *
 * IMPORTANTE — Por qué es informativo:
 *   El COP real ya fue registrado como `expense` cuando se pagó la bolsa al
 *   proveedor. Las líneas de esta sección NO se suman a `expenses`; sirven
 *   para entender la "unit economics" — cuánto del costo prepagado se está
 *   consumiendo en cada propiedad.
 *
 * Modos:
 *   - "global": agrupa por propiedad, lista todas las bolsas que la afectan.
 *   - "single-property": muestra sólo las bolsas que tocan la propiedad dada.
 *
 * Se renderiza colapsable por defecto para no saturar.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getCreditPoolCostByProperty, type PoolCostByPropertyRow } from '@/services/creditPools';

export interface CreditPoolAttributionPanelProps {
  /** Filtro opcional por propiedad. Si se pasa, sólo muestra esa propiedad. */
  propertyId?: string;
  /** Mapa property_id → nombre. */
  propertyMap: Map<string, string>;
  /** Rango ISO (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Forzar abierto al montar. */
  defaultOpen?: boolean;
  /** Variantes de presentación. */
  variant?: 'card' | 'print';
}

interface PropertyBucket {
  propertyId: string;
  rows: PoolCostByPropertyRow[];
  totalCredits: number;
  totalCost: number;
}

export default function CreditPoolAttributionPanel({
  propertyId, propertyMap, from, to,
  defaultOpen = false, variant = 'card',
}: CreditPoolAttributionPanelProps) {
  const [rows, setRows] = useState<PoolCostByPropertyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCreditPoolCostByProperty({ from, to, propertyId }).then(res => {
      if (cancelled) return;
      setRows(res.error ? [] : res.data ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [propertyId, from, to]);

  const buckets = useMemo<PropertyBucket[]>(() => {
    if (!rows) return [];
    const byProp = new Map<string, PropertyBucket>();
    for (const r of rows) {
      const b = byProp.get(r.property_id);
      if (b) {
        b.rows.push(r);
        b.totalCredits += r.credits;
        b.totalCost += r.cost_cop;
      } else {
        byProp.set(r.property_id, {
          propertyId: r.property_id,
          rows: [r],
          totalCredits: r.credits,
          totalCost: r.cost_cop,
        });
      }
    }
    return [...byProp.values()].sort((a, b) => b.totalCost - a.totalCost);
  }, [rows]);

  const grandTotal = useMemo(
    () => buckets.reduce((s, b) => s + b.totalCost, 0),
    [buckets],
  );

  if (loading) {
    if (variant === 'print') return null;
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-500">
        Cargando atribución de bolsas…
      </div>
    );
  }
  if (buckets.length === 0) {
    return null;
  }

  if (variant === 'print') {
    return (
      <section className="break-inside-avoid mt-4">
        <h3 className="text-sm font-bold text-slate-800 mb-2">
          🪙 Atribución de bolsas de créditos
          <span className="ml-2 text-xs font-normal text-slate-500">
            (informativo — el costo ya está en gastos de compra de la bolsa)
          </span>
        </h3>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="px-2 py-1 border border-slate-200">Propiedad</th>
              <th className="px-2 py-1 border border-slate-200">Bolsa</th>
              <th className="px-2 py-1 border border-slate-200 text-right">Créditos</th>
              <th className="px-2 py-1 border border-slate-200 text-right">Costo atribuido</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(b => b.rows.map((r, idx) => (
              <tr key={`${b.propertyId}-${r.pool_id}`}>
                {idx === 0 && (
                  <td className="px-2 py-1 border border-slate-200 align-top font-semibold"
                    rowSpan={b.rows.length}>
                    {propertyMap.get(b.propertyId) ?? b.propertyId.slice(0, 8)}
                  </td>
                )}
                <td className="px-2 py-1 border border-slate-200">{r.pool_name}</td>
                <td className="px-2 py-1 border border-slate-200 text-right">{r.credits.toFixed(2)}</td>
                <td className="px-2 py-1 border border-slate-200 text-right">{formatCurrency(r.cost_cop)}</td>
              </tr>
            )))}
            <tr className="bg-amber-50 font-bold">
              <td className="px-2 py-1 border border-slate-200" colSpan={3}>Total</td>
              <td className="px-2 py-1 border border-slate-200 text-right">{formatCurrency(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <div className="bg-white border border-amber-200 rounded-2xl shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/40 rounded-2xl"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-amber-700" /> : <ChevronRight className="w-4 h-4 text-amber-700" />}
          <span className="font-semibold text-slate-800 text-sm">🪙 Atribución de bolsas por propiedad</span>
          <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
            informativo
          </span>
        </div>
        <span className="text-sm font-mono text-amber-700">{formatCurrency(grandTotal)}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-amber-100">
          <p className="text-[11px] text-slate-500 mt-2 mb-3">
            Este desglose muestra cuánto del costo prepagado de cada bolsa fue
            consumido por cada propiedad (créditos × precio congelado al consumo).
            <b> No se suma a los gastos</b>: el COP real ya quedó registrado cuando
            pagaste la bolsa al proveedor.
          </p>
          <div className="space-y-3">
            {buckets.map(b => (
              <div key={b.propertyId} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-800">
                    {propertyMap.get(b.propertyId) ?? b.propertyId.slice(0, 8)}
                  </span>
                  <span className="text-sm font-mono text-amber-700">
                    {b.totalCredits.toFixed(1)} créd · {formatCurrency(b.totalCost)}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {b.rows.map(r => (
                    <div key={r.pool_id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                      <div className="min-w-0 flex-1 truncate">
                        <span className="text-slate-700">{r.pool_name}</span>
                        <span className="text-slate-400 ml-2">· {r.consumptions} consumo{r.consumptions !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <span className="text-slate-500 mr-3">{r.credits.toFixed(2)} créd</span>
                        <span className="font-mono text-slate-700">{formatCurrency(r.cost_cop)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
