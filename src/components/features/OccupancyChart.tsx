import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import type { MonthlyPnL } from '@/services/financial';

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyPnL }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-xl shadow-xl border p-3 text-sm">
      <p className="font-bold text-slate-700 mb-1">{label}</p>
      <p className="text-slate-600">
        Ocupación: <span className="font-semibold text-slate-800">{d.occupancy}%</span>
      </p>
      <p className="text-slate-500 text-xs mt-0.5">{d.nights} noches reservadas</p>
    </div>
  );
};

interface Props {
  data: MonthlyPnL[];
  breakEvenOccupancy: number; // 0-100
}

export default function OccupancyChart({ data, breakEvenOccupancy }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-800">Ocupación Mensual</h3>
        {breakEvenOccupancy > 0 && (
          <div className="flex items-center gap-2 text-xs">
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
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={8} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={v => `${v}%`}
                domain={[0, 100]}
              />
              <Tooltip content={<CustomTooltip />} />
              {breakEvenOccupancy > 0 && (
                <ReferenceLine
                  y={breakEvenOccupancy}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                  label={{
                    value: `BE ${breakEvenOccupancy}%`,
                    fill: '#d97706',
                    fontSize: 11,
                    position: 'insideTopRight',
                  }}
                />
              )}
              <Bar dataKey="occupancy" name="Ocupación" radius={[4, 4, 0, 0]} barSize={28}>
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.occupancy >= breakEvenOccupancy ? '#22c55e' : '#f87171'}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
