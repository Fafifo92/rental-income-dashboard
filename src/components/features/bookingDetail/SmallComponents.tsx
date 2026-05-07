import { formatCurrency } from '@/lib/utils';

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

export function Metric({
  label, value, tone, bold,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'rose' | 'amber';
  bold?: boolean;
}) {
  const toneClass = {
    slate:   'text-slate-800',
    emerald: 'text-emerald-700',
    rose:    'text-rose-700',
    amber:   'text-amber-700',
  }[tone];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-0.5 tabular-nums ${toneClass} ${bold ? 'text-lg font-bold' : 'font-semibold'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
