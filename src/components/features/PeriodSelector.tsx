import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Period } from '@/services/financial';
import { todayISO } from '@/lib/dateUtils';

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'current-month',  label: 'Este mes' },
  { value: 'last-3-months',  label: 'Últ. 3 meses' },
  { value: 'this-year',      label: 'Este año' },
  { value: 'all',            label: 'Todo' },
  { value: 'custom',         label: 'Personalizado' },
];

interface Props {
  value: Period;
  onChange: (p: Period) => void;
  customRange?: { from: string; to: string };
  onCustomRangeChange?: (r: { from: string; to: string }) => void;
}

export default function PeriodSelector({ value, onChange, customRange, onCustomRangeChange }: Props) {
  const today      = todayISO();
  const [from, setFrom] = useState(customRange?.from ?? '');
  const [to,   setTo  ] = useState(customRange?.to   ?? '');

  // Sync local state when parent resets
  useEffect(() => {
    if (customRange) { setFrom(customRange.from); setTo(customRange.to); }
  }, [customRange?.from, customRange?.to]);

  const applyRange = (f: string, t: string) => {
    if (f && t && f <= t && onCustomRangeChange) {
      onCustomRangeChange({ from: f, to: t });
    }
  };

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl flex-wrap">
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative px-3 py-2 text-sm font-medium rounded-lg"
          >
            {value === opt.value && (
              <motion.span
                layoutId="period-pill"
                className="absolute inset-0 bg-white rounded-lg shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                value === opt.value ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </span>
          </button>
        ))}
      </div>

      {/* Inline date-range picker — only visible when 'custom' is selected */}
      <AnimatePresence>
        {value === 'custom' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm text-sm"
          >
            <span className="text-slate-500 text-xs font-medium">Desde</span>
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={e => {
                setFrom(e.target.value);
                applyRange(e.target.value, to);
              }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-slate-400">–</span>
            <span className="text-slate-500 text-xs font-medium">Hasta</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={e => { setTo(e.target.value); applyRange(from, e.target.value); }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
