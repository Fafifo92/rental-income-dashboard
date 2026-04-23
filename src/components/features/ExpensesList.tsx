import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { formatCurrency } from '@/lib/utils';
import type { Expense } from '@/types';
import DataTable from './DataTable';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  paid:    { label: 'Pagado',    className: 'bg-green-100 text-green-700'   },
  pending: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-700' },
  partial: { label: 'Parcial',   className: 'bg-orange-100 text-orange-700' },
};

const TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  fixed:    { label: 'Fijo',     className: 'bg-blue-50 text-blue-700'    },
  variable: { label: 'Variable', className: 'bg-slate-100 text-slate-600' },
};

const isSynthetic = (id: string) => id.startsWith('rec-') || id.startsWith('fee-');
const syntheticKind = (id: string): 'Recurrente' | 'Fees canal' | null => {
  if (id.startsWith('rec-')) return 'Recurrente';
  if (id.startsWith('fee-')) return 'Fees canal';
  return null;
};

const helper = createColumnHelper<Expense>();

interface Props {
  expenses: Expense[];
  loading?: boolean;
  onDelete?: (id: string) => void;
  onEdit?: (expense: Expense) => void;
  onView?: (expense: Expense) => void;
}

export default function ExpensesList({ expenses, loading = false, onDelete, onEdit, onView }: Props) {
  const columns = useMemo<ColumnDef<Expense, any>[]>(() => {
    const cols: ColumnDef<Expense, any>[] = [
      helper.accessor('category', {
        header: 'Categoría',
        cell: info => {
          const row = info.row.original;
          const kind = syntheticKind(row.id);
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-800">{info.getValue()}</span>
              {kind && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  kind === 'Recurrente'
                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}>
                  {kind}
                </span>
              )}
              {row.booking_id && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 font-mono"
                  title="Gasto vinculado a una reserva"
                >
                  🔗 Reserva
                </span>
              )}
            </div>
          );
        },
      }),
      helper.accessor('type', {
        header: 'Tipo',
        cell: info => {
          const cfg = TYPE_CONFIG[info.getValue()] ?? { label: info.getValue(), className: '' };
          return (
            <span className={`px-2 py-1 rounded-md text-xs font-medium ${cfg.className}`}>
              {cfg.label}
            </span>
          );
        },
      }),
      helper.accessor('date', {
        header: 'Fecha',
        meta: { className: 'text-slate-500 whitespace-nowrap' },
        cell: info => info.getValue(),
      }),
      helper.accessor('description', {
        header: 'Descripción',
        enableSorting: false,
        meta: { className: 'text-slate-500 max-w-[200px] truncate' },
        cell: info => info.getValue() ?? '—',
      }),
      helper.accessor('amount', {
        header: 'Monto',
        meta: { align: 'right' },
        sortingFn: 'basic',
        cell: info => (
          <span className="font-semibold text-slate-800">{formatCurrency(info.getValue())}</span>
        ),
      }),
      helper.accessor('status', {
        header: 'Estado',
        meta: { align: 'center' },
        cell: info => {
          const cfg = STATUS_CONFIG[info.getValue()] ?? {
            label: info.getValue(),
            className: 'bg-slate-100 text-slate-600',
          };
          return (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cfg.className}`}>
              {cfg.label}
            </span>
          );
        },
      }),
    ];

    if (onView || onEdit || onDelete) {
      cols.push(
        helper.display({
          id: 'actions',
          header: 'Acciones',
          enableSorting: false,
          meta: { align: 'center', className: 'w-32 whitespace-nowrap' },
          cell: info => {
            const row = info.row.original;
            const synthetic = isSynthetic(row.id);
            return (
              <div className="flex items-center justify-center gap-1">
                {onView && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onView(row)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Ver detalle"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </motion.button>
                )}
                {onEdit && !synthetic && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onEdit(row)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                    title="Editar"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </motion.button>
                )}
                {onDelete && !synthetic && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onDelete(row.id)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Eliminar"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
                    </svg>
                  </motion.button>
                )}
                {synthetic && <span className="text-xs text-slate-300 px-2" title="Entrada automática">auto</span>}
              </div>
            );
          },
        }),
      );
    }

    return cols;
  }, [onDelete, onEdit, onView]);

  return (
    <DataTable<Expense>
      columns={columns}
      data={expenses}
      loading={loading}
      showSearch
      searchPlaceholder="Buscar por categoría, tipo o descripción…"
      defaultPageSize={25}
      skeletonRows={5}
      emptyIcon=""
      emptyTitle="Sin gastos registrados"
      emptyDescription="Registra tu primer gasto usando el botón de arriba."
      renderFooter={filteredData => {
        const total = filteredData.reduce((sum, e) => sum + e.amount, 0);
        const hasActions = !!(onDelete || onEdit || onView);
        const colSpanLeft = hasActions ? 4 : 3;
        const colSpanRight = hasActions ? 2 : 1;
        return (
          <tr className="border-t bg-slate-50">
            <td colSpan={colSpanLeft} className="px-5 py-4 font-semibold text-slate-700">
              Total ({filteredData.length} registro{filteredData.length !== 1 ? 's' : ''})
            </td>
            <td className="px-5 py-4 text-right font-bold text-slate-900">
              {formatCurrency(total)}
            </td>
            <td colSpan={colSpanRight} />
          </tr>
        );
      }}
    />
  );
}

