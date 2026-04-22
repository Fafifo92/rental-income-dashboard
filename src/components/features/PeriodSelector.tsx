import { motion } from 'framer-motion';
import type { Period } from '@/services/financial';

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'current-month',  label: 'Este mes' },
  { value: 'last-3-months',  label: 'Últimos 3 meses' },
  { value: 'this-year',      label: 'Este año' },
  { value: 'all',            label: 'Todo' },
];

interface Props {
  value: Period;
  onChange: (p: Period) => void;
}

export default function PeriodSelector({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="relative px-4 py-2 text-sm font-medium rounded-lg"
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
  );
}
