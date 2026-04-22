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
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
      positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {positive ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}%
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KPIItem {
  label: string;
  sublabel?: string;
  icon: string;
  value: number;
  format: (n: number) => string;
  color: string;
  accent: string;   // left border color
  bg: string;
  delta?: number | null;
}

function KPICard({ item, delay }: { item: KPIItem; delay: number }) {
  const animated = useCountUp(item.value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
      className="relative flex flex-col gap-4 p-6 rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
    >
      {/* Accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.accent} rounded-l-2xl`} />

      {/* Top row: icon + delta */}
      <div className="flex items-start justify-between pl-2">
        <span className={`flex items-center justify-center w-10 h-10 rounded-xl text-xl ${item.bg}`}>
          {item.icon}
        </span>
        {item.delta !== undefined && <DeltaBadge delta={item.delta} />}
      </div>

      {/* Value */}
      <p className={`text-3xl font-extrabold tracking-tight leading-none pl-2 ${item.color}`}>
        {item.format(animated)}
      </p>

      {/* Label + sublabel */}
      <div className="pl-2 -mt-1">
        <p className="text-sm font-semibold text-slate-700">{item.label}</p>
        {item.sublabel && <p className="text-xs text-slate-400 mt-0.5">{item.sublabel}</p>}
      </div>
    </motion.div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-36 rounded-2xl bg-slate-100 animate-pulse border border-slate-200" />
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
      icon: '💰',
      value: kpis.grossRevenue,
      format: formatCOP,
      color: 'text-blue-700',
      accent: 'bg-blue-500',
      bg: 'bg-blue-50',
      delta: kpis.vsLastPeriod.grossRevenue,
    },
    {
      label: 'Gastos Totales',
      sublabel: 'Fijos + variables',
      icon: '📉',
      value: kpis.totalExpenses,
      format: formatCOP,
      color: 'text-red-600',
      accent: 'bg-red-400',
      bg: 'bg-red-50',
    },
    {
      label: 'Utilidad Neta',
      sublabel: 'Ingresos − Gastos',
      icon: '📊',
      value: kpis.netProfit,
      format: formatCOP,
      color: kpis.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600',
      accent: kpis.netProfit >= 0 ? 'bg-emerald-500' : 'bg-red-400',
      bg: kpis.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50',
      delta: kpis.vsLastPeriod.netProfit,
    },
    {
      label: 'Ocupación',
      sublabel: 'Noches ocupadas',
      icon: '🏠',
      value: Math.round(kpis.occupancyRate * 100),
      format: formatPercent,
      color: 'text-orange-600',
      accent: 'bg-orange-400',
      bg: 'bg-orange-50',
      delta: kpis.vsLastPeriod.occupancyRate,
    },
    {
      label: 'ADR',
      sublabel: 'Tarifa promedio',
      icon: '🌙',
      value: kpis.adr,
      format: formatCOP,
      color: 'text-slate-700',
      accent: 'bg-slate-400',
      bg: 'bg-slate-100',
    },
    {
      label: 'RevPAR',
      sublabel: 'Ingreso por noche',
      icon: '✨',
      value: kpis.revpar,
      format: formatCOP,
      color: 'text-purple-700',
      accent: 'bg-purple-500',
      bg: 'bg-purple-50',
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


