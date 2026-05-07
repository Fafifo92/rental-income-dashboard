import { type ExpenseSection, type ExpenseSubcategory, EXPENSE_SUBCATEGORY_META } from '@/types/database';
import { formatCurrency } from '@/lib/utils';

type Tab = 'all' | ExpenseSection | 'others';

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
  subFilter: ExpenseSubcategory | null;
  setSubFilter: (s: ExpenseSubcategory | null) => void;
  tabCounts: Record<'all' | 'property' | 'booking' | 'others', number>;
  visibleTotal: number;
  visibleFees: number;
  subCountsBySection: (sec: ExpenseSection) => Partial<Record<ExpenseSubcategory, number>>;
}

const TABS = [
  { key: 'all',      label: 'Todos',             color: 'text-slate-700', hint: 'Vista consolidada de todos los gastos' },
  { key: 'property', label: 'Sobre propiedades', color: 'text-blue-700',  hint: 'Operación del inmueble: servicios, admin, mantenimiento, stock' },
  { key: 'booking',  label: 'Sobre reservas',    color: 'text-rose-700',  hint: 'Atribuibles a un huésped: aseo del turn, daños, atenciones' },
  { key: 'others',   label: 'Otros gastos',      color: 'text-slate-700', hint: 'Comisiones de canal (Booking, Airbnb), fees y gastos sin clasificar' },
] as const;

export default function ExpensesTabsBar({
  tab, setTab, subFilter, setSubFilter, tabCounts, visibleTotal, visibleFees, subCountsBySection,
}: Props) {
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSubFilter(null); }}
            title={t.hint}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? `${t.color} border-current`
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {t.label} <span className="ml-1 text-xs text-slate-400">({tabCounts[t.key]})</span>
          </button>
        ))}
      </div>

      {tab !== 'all' && tab !== 'others' && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          <button
            onClick={() => setSubFilter(null)}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              subFilter === null
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Todas
          </button>
          {(Object.entries(EXPENSE_SUBCATEGORY_META) as [ExpenseSubcategory, typeof EXPENSE_SUBCATEGORY_META[ExpenseSubcategory]][])
            .filter(([, meta]) => meta.section === tab)
            .map(([sub, meta]) => {
              const count = subCountsBySection(tab)[sub] ?? 0;
              return (
                <button
                  key={sub}
                  onClick={() => setSubFilter(sub)}
                  title={meta.description}
                  className={`px-2.5 py-1 text-xs rounded-full border transition ${
                    subFilter === sub
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {meta.icon} {meta.label} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 px-1 text-sm">
        <p className="text-slate-500">
          {tab === 'all' && 'Mostrando todas las fuentes de gasto combinadas.'}
          {tab === 'property' && 'Operación del inmueble: existen aunque no haya huésped.'}
          {tab === 'booking' && 'Atribuibles a un huésped específico.'}
          {tab === 'others' && 'Comisiones de canal y gastos sin sección (Booking/Airbnb fees, etc.).'}
        </p>
        <p className="font-semibold text-slate-800">
          Total: <span className="text-slate-900">{formatCurrency(visibleTotal)}</span>
          {visibleFees > 0 && (
            <span className="ml-2 text-xs text-slate-400 font-normal">
              + {formatCurrency(visibleFees)} fees
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
