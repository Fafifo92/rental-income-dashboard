import { useState, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import type { MonthlyPnL } from '@/services/financial';
import { formatCurrency } from '@/lib/utils';

interface TooltipEntry {
  dataKey: string;
  name: string;
  value: number;
  color: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-xl border p-4 text-sm min-w-[200px]">
      <p className="font-bold text-slate-700 mb-3">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 mb-1.5">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold text-slate-800">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

interface ChartProps {
  data: MonthlyPnL[];
}

export default function RevenueChart({ data }: ChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tickFmt = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return `${v}`;
  };

  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <h3 className="text-lg font-bold mb-4 text-slate-800">Ingresos vs Gastos</h3>
      <div className="h-72">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={tickFmt} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <ReferenceLine y={0} stroke="#e2e8f0" />
              <Bar dataKey="revenue"  name="Ingresos"      fill="#3b82f6" radius={[4,4,0,0]} barSize={20} />
              <Bar dataKey="expenses" name="Gastos"         fill="#f87171" radius={[4,4,0,0]} barSize={20} />
              <Line
                type="monotone"
                dataKey="netProfit"
                name="Utilidad Neta"
                stroke="#22c55e"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#22c55e', stroke: 'white', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

