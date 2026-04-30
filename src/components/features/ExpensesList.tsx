import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FileText, Pencil, Trash2 } from 'lucide-react';
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
              {row.adjustment_id && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-50 text-amber-800 border-amber-200"
                  title="Generado automáticamente desde un cobro por daño en la reserva"
                >
                  ⚠️ Daño huésped
                </span>
              )}
              {row.booking_id && !row.adjustment_id && (
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
        cell: info => {
          const row = info.row.original as Expense & { expense_group_id?: string | null; subcategory?: string | null };
          const isCleaningGroup = (row.subcategory ?? '').toLowerCase() === 'cleaning';
          return (
            <span className="flex items-center gap-1.5">
              <span className="truncate">{info.getValue() ?? '—'}</span>
              {row.expense_group_id && !isCleaningGroup && (
                <span
                  title="Gasto compartido entre varias propiedades"
                  className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-100 text-violet-700 flex-shrink-0"
                >
                  ⇄ Compartido
                </span>
              )}
              {row.expense_group_id && isCleaningGroup && (
                <span
                  title="Parte de una liquidación de aseo"
                  className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-cyan-100 text-cyan-700 flex-shrink-0"
                >
                  💸 Liquidación
                </span>
              )}
            </span>
          );
        },
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
                    title="Ver comprobante / detalle"
                    aria-label="Ver detalle del gasto"
                  >
                    <FileText className="w-4 h-4" />
                  </motion.button>
                )}
                {onEdit && !synthetic && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onEdit(row)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                    title="Editar gasto"
                    aria-label="Editar gasto"
                  >
                    <Pencil className="w-4 h-4" />
                  </motion.button>
                )}
                {onDelete && !synthetic && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onDelete(row.id)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Eliminar gasto"
                    aria-label="Eliminar gasto"
                  >
                    <Trash2 className="w-4 h-4" />
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

