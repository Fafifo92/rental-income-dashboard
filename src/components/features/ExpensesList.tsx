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

const helper = createColumnHelper<Expense>();

interface Props {
  expenses: Expense[];
  loading?: boolean;
  onDelete?: (id: string) => void;
}

export default function ExpensesList({ expenses, loading = false, onDelete }: Props) {
  const columns = useMemo<ColumnDef<Expense, any>[]>(() => {
    const cols: ColumnDef<Expense, any>[] = [
      helper.accessor('category', {
        header: 'Categoría',
        cell: info => <span className="font-medium text-slate-800">{info.getValue()}</span>,
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

    if (onDelete) {
      cols.push(
        helper.display({
          id: 'actions',
          enableSorting: false,
          meta: { align: 'center', className: 'w-10' },
          cell: info => (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => onDelete(info.row.original.id)}
              className="text-slate-300 hover:text-red-400 transition-colors text-base"
              title="Eliminar"
            >
              🗑
            </motion.button>
          ),
        }),
      );
    }

    return cols;
  }, [onDelete]);

  return (
    <DataTable<Expense>
      columns={columns}
      data={expenses}
      loading={loading}
      showSearch
      searchPlaceholder="Buscar por categoría, tipo o descripción…"
      defaultPageSize={25}
      skeletonRows={5}
      emptyIcon="🗂️"
      emptyTitle="Sin gastos registrados"
      emptyDescription="Registra tu primer gasto usando el botón de arriba."
      renderFooter={filteredData => {
        const total = filteredData.reduce((sum, e) => sum + e.amount, 0);
        const colSpanLeft = onDelete ? 4 : 3;
        const colSpanRight = onDelete ? 2 : 1;
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

