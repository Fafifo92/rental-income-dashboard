import { useState, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import type { MonthlyPnL, ChartGranularity } from '@/services/financial';

interface ChartEntry extends MonthlyPnL {
  freeNights: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload: ChartEntry }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-xl shadow-xl border p-3 text-sm min-w-[160px]">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Reservadas</span>
          <span className="font-semibold text-emerald-600">{d.nights} n.</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Disponibles</span>
          <span className="font-semibold text-slate-600">{d.availableNights} n.</span>
        </div>
        <div className="border-t pt-1 mt-1 flex justify-between gap-4">
          <span className="text-slate-500">Ocupación</span>
          <span className="font-bold text-blue-600">{d.occupancy}%</span>
        </div>
      </div>
    </div>
  );
};

const GRAN_LABEL: Record<ChartGranularity, string> = {
  day:   'Diaria',
  week:  'Semanal',
  month: 'Mensual',
};

interface Props {
  data: MonthlyPnL[];
  breakEvenOccupancy: number; // 0-100
  granularity?: ChartGranularity;
  totalNights: number;
  availableNights: number;
}

export default function OccupancyChart({ data, breakEvenOccupancy, granularity = 'month', totalNights, availableNights }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chartData: ChartEntry[] = data.map(d => ({
    ...d,
    freeNights: Math.max(0, d.availableNights - d.nights),
  }));

  // Break-even reference in nights (average across buckets)
  const avgAvailable = data.length > 0
    ? data.reduce((s, d) => s + d.availableNights, 0) / data.length
    : 1;
  const breakEvenNights = Math.round((breakEvenOccupancy / 100) * avgAvailable);

  const overallPct = availableNights > 0 ? Math.round((totalNights / availableNights) * 100) : 0;

  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <div className="flex items-start justify-between mb-2 gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800">
            Ocupación {GRAN_LABEL[granularity]}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalNights} de {availableNights} noches &mdash;{' '}
            <span className={overallPct >= breakEvenOccupancy ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
              {overallPct}% ocupado
            </span>
          </p>
        </div>
        {breakEvenOccupancy > 0 && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <svg width="24" height="4" viewBox="0 0 24 4" className="shrink-0">
              <line x1="0" y1="2" x2="24" y2="2" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            <span className="text-amber-600 font-semibold">Break-even {breakEvenOccupancy}%</span>
          </div>
        )}
      </div>
      <div className="h-52 w-full">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={8} />
              <YAxis
                yAxisId="nights"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={v => `${v}n`}
                width={32}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => `${v}%`}
                domain={[0, 100]}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} />
              {breakEvenNights > 0 && (
                <ReferenceLine
                  yAxisId="nights"
                  y={breakEvenNights}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                />
              )}
              {/* Stacked bar: reservadas (colored) + libres (gray) */}
              <Bar yAxisId="nights" dataKey="nights" name="Reservadas" stackId="occ" radius={[0,0,0,0]} barSize={28}
                fill="#22c55e" fillOpacity={0.85} />
              <Bar yAxisId="nights" dataKey="freeNights" name="Libres" stackId="occ" radius={[4,4,0,0]} barSize={28}
                fill="#e2e8f0" fillOpacity={0.7} />
              {/* Occupancy % line */}
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="occupancy"
                name="Ocup. %"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6' }}
                activeDot={{ r: 5 }}
              />
              <Legend
                iconType="square"
                iconSize={10}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(value) => <span className="text-slate-600">{value}</span>}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
