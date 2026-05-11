import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { FinancialKPIs } from '@/services/financial';

// ─── Number formatters ────────────────────────────────────────────────────────

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(n: number): string {
  return `${n.toFixed(0)}%`;
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    setValue(0);
    if (target === 0) return;
    const absTarget = Math.abs(target);
    const isNeg     = target < 0;
    const steps     = Math.ceil(duration / 16);
    const increment = absTarget / steps;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + increment, absTarget);
      setValue(isNeg ? -current : current);
      if (current >= absTarget) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return value;
}

// ─── Delta badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return null;
  const positive = delta >= 0;
  const absPercent = Math.abs(delta * 100);
  // Values at cap (500%) signal early-stage/sparse baseline — show as ">500%"
  const isCapped = absPercent >= 499.9;
  const displayVal = isCapped ? '>500' : absPercent.toFixed(1);
  return (
    <span
      title={isCapped ? 'Variación muy alta: el período anterior tiene datos insuficientes para una comparación confiable.' : undefined}
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
        positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {positive ? '▲' : '▼'} {displayVal}%
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KPIItem {
  label: string;
  sublabel?: string;
  value: number;
  format: (n: number) => string;
  color: string;
  accent: string;
  delta?: number | null;
}

function KPICard({ item, delay }: { item: KPIItem; delay: number }) {
  const animated = useCountUp(item.value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: 'easeOut' }}
      className="relative flex flex-col gap-1 p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
    >
      {/* Accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.accent} rounded-l-xl`} />

      {/* Label row + delta */}
      <div className="flex items-center justify-between pl-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{item.label}</p>
        {item.delta !== undefined && <DeltaBadge delta={item.delta} />}
      </div>

      {/* Value */}
      <p className={`text-2xl font-extrabold tracking-tight leading-none pl-2 ${item.color}`}>
        {item.format(animated)}
      </p>

      {/* Sublabel */}
      {item.sublabel && <p className="text-xs text-slate-400 pl-2">{item.sublabel}</p>}
    </motion.div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse border border-slate-200" />
      ))}
    </div>
  );
}

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export default function DashboardSummary({ kpis }: { kpis: FinancialKPIs }) {
  const items: KPIItem[] = [
    {
      label: 'Ingreso Bruto',
      sublabel: 'Total reservas',
      value: kpis.grossRevenue,
      format: formatCOP,
      color: 'text-blue-700',
      accent: 'bg-blue-500',
      delta: kpis.vsLastPeriod.grossRevenue,
    },
    {
      label: 'Gastos Totales',
      sublabel: 'Fijos + variables',
      value: kpis.totalExpenses,
      format: formatCOP,
      color: 'text-red-600',
      accent: 'bg-red-400',
    },
    {
      label: 'Utilidad Neta',
      sublabel: 'Ingresos − Gastos',
      value: kpis.netProfit,
      format: formatCOP,
      color: kpis.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600',
      accent: kpis.netProfit >= 0 ? 'bg-emerald-500' : 'bg-red-400',
      delta: kpis.vsLastPeriod.netProfit,
    },
    {
      label: 'Ocupación',
      sublabel: `${kpis.totalNights} de ${kpis.availableNights} noches`,
      value: Math.round(kpis.occupancyRate * 100),
      format: formatPercent,
      color: 'text-orange-600',
      accent: 'bg-orange-400',
      delta: kpis.vsLastPeriod.occupancyRate,
    },
    {
      label: 'ADR',
      sublabel: 'Tarifa promedio',
      value: kpis.adr,
      format: formatCOP,
      color: 'text-slate-700',
      accent: 'bg-slate-400',
    },
    {
      label: 'RevPAR',
      sublabel: 'Ingreso por noche',
      value: kpis.revpar,
      format: formatCOP,
      color: 'text-purple-700',
      accent: 'bg-purple-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {items.map((item, i) => (
        <KPICard key={item.label} item={item} delay={i * 0.07} />
      ))}
    </div>
  );
}


