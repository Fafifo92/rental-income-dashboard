import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FileText, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import type { Expense, GroupedExpense } from '@/types';
import type { BankAccountRow } from '@/types/database';
import DataTable from './DataTable';
import { cleanDamageDescription } from '@/lib/damageDescription';
import { groupExpenses } from '@/lib/expenseGrouping';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  paid:    { label: 'Pagado',    className: 'bg-green-100 text-green-700'   },
  pending: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-700' },
  partial: { label: 'Parcial',   className: 'bg-orange-100 text-orange-700' },
};

const isSynthetic = (id: string) => id.startsWith('rec-') || id.startsWith('fee-') || id.startsWith('fine-');
const syntheticKind = (id: string): 'Recurrente' | 'Fees canal · info' | 'Multa cancelación' | null => {
  if (id.startsWith('rec-'))  return 'Recurrente';
  if (id.startsWith('fee-'))  return 'Fees canal · info';
  if (id.startsWith('fine-')) return 'Multa cancelación';
  return null;
};

const helper = createColumnHelper<GroupedExpense>();

/** Returns true if an expense is cleaning-related (by subcategory OR category). */
const isCleaning = (r: { subcategory?: string | null; category?: string | null }) =>
  r.subcategory === 'cleaning' || r.category === 'Aseo' || r.category === 'Insumos de aseo';

/** Extracts structured info from cleaning expense descriptions.
 *  Format: "Aseo – PropName · Reserva CODE (DATE) · CleanerName"
 *  Or:     "Insumos de aseo – PropName · Reserva CODE (DATE) · CleanerName"
 *  Uses indexOf('Reserva ') so the separator character doesn't matter.
 */
function parseCleaningDesc(desc: string | null): {
  propName: string; code: string; doneDate: string; isSupplies: boolean;
} | null {
  if (!desc) return null;
  const isSupplies = /^insumos/i.test(desc.trimStart());
  const reservaIdx = desc.indexOf('Reserva ');
  if (reservaIdx === -1) return null;
  // Prop name: between "Aseo – " / "Insumos de aseo – " and the separator before "Reserva"
  const beforeReserva = desc.slice(0, reservaIdx).trim();
  const propMatch = beforeReserva.match(/^(?:Insumos de aseo|Aseo)\s*[–-]\s*(.+?)[\s·•|,]*$/i);
  const propName = propMatch ? propMatch[1].trim() : beforeReserva;
  // Code and date: "CODE (DATE)" right after "Reserva "
  const afterReserva = desc.slice(reservaIdx + 'Reserva '.length);
  const reservaMatch = afterReserva.match(/^([^\s(·•]+)\s*\(([^)]+)\)/);
  if (!reservaMatch) return null;
  return { propName, code: reservaMatch[1].trim(), doneDate: reservaMatch[2].trim(), isSupplies };
}

interface Props {
  expenses: Expense[];
  loading?: boolean;
  bankAccounts?: BankAccountRow[];
  /** Map of property_id → property name, used to label group children */
  propertyMap?: Map<string, string>;
  onDelete?: (id: string) => void;
  onDeleteGroup?: (expense: GroupedExpense) => void;
  onEdit?: (expense: Expense) => void;
  onEditGroup?: (expense: GroupedExpense) => void;
  onView?: (expense: Expense) => void;
}

export default function ExpensesList({ expenses, loading = false, bankAccounts = [], propertyMap = new Map(), onDelete, onDeleteGroup, onEdit, onEditGroup, onView }: Props) {
  const accountMap = useMemo(() => new Map(bankAccounts.map(a => [a.id, a])), [bankAccounts]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupId: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });

  const groupedExpenses = useMemo(
    () => groupExpenses(expenses, expandedGroups),
    [expenses, expandedGroups],
  );

  const columns = useMemo<ColumnDef<GroupedExpense, any>[]>(() => {
    const cols: ColumnDef<GroupedExpense, any>[] = [
      helper.accessor('category', {
        header: 'Categoría',
        cell: info => {
          const row = info.row.original;
          const kind = syntheticKind(row.id);

          // ── Cleaning child row ──────────────────────────────────────────
          if (row.isChild && isCleaning(row)) {
            const parsed = parseCleaningDesc(row.description);
            const isSupplies = row.category === 'Insumos de aseo' || parsed?.isSupplies === true;
            const propLabel = parsed?.propName
              ?? (row.property_id ? (propertyMap.get(row.property_id) ?? 'Propiedad') : 'Sin propiedad');
            return (
              <div className="flex items-center gap-1.5 pl-7 flex-wrap">
                <span className="text-[10px] text-slate-400">└</span>
                {/* Property is the primary badge — that's the useful context in the breakdown */}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold truncate max-w-[140px] ${
                  isSupplies
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                }`}>
                  {propLabel}
                </span>
                {parsed?.code && (
                  <span className="font-mono text-[10px] text-slate-500">{parsed.code}</span>
                )}
                {!parsed?.code && row.booking_id && (
                  <span className="font-mono text-[10px] text-slate-500">{row.booking_id.slice(0, 8)}</span>
                )}
                {isSupplies && (
                  <span className="text-[9px] text-amber-600 italic">insumos</span>
                )}
              </div>
            );
          }

          // ── Child row (expanded group member) ──────────────────────────────
          if (row.isChild) {
            const propName = row.property_id ? (propertyMap.get(row.property_id) ?? row.property_id.slice(0, 8)) : 'General';
            return (
              <div className="flex items-center gap-2 pl-7 flex-wrap">
                <span className="text-[10px] text-slate-400">└</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                  {propName}
                </span>
              </div>
            );
          }

          // ── Group header row ────────────────────────────────────────────────
          if (row.isGroup) {
            const gid = row.expense_group_id!;
            const isExpanded = expandedGroups.has(gid);
            const isCleaningGroup = isCleaning(row) || (row.children ?? []).some(c => isCleaning(c));

            if (isCleaningGroup) {
              const bookingCount = Math.max(
                new Set((row.children ?? []).map(c => c.booking_id).filter(Boolean)).size,
                1,
              );
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleGroup(gid)}
                    className="p-0.5 rounded hover:bg-sky-100 text-sky-600 transition-colors flex-shrink-0"
                    title={isExpanded ? 'Contraer aseos' : 'Ver detalle por reserva'}
                    aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <span className="font-medium text-sky-800">Liquidación de Aseo</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-100 text-cyan-700 border border-cyan-200 flex-shrink-0">
                    Liquidación
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-50 text-sky-600 border border-sky-200 flex-shrink-0">
                    {bookingCount} aseo{bookingCount !== 1 ? 's' : ''}
                  </span>
                </div>
              );
            }

            return (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => toggleGroup(gid)}
                  className="p-0.5 rounded hover:bg-violet-100 text-violet-600 transition-colors flex-shrink-0"
                  title={isExpanded ? 'Contraer propiedades' : 'Ver desglose por propiedad'}
                  aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                >
                  {isExpanded
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <span className="font-medium text-slate-800">{info.getValue()}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-200 flex-shrink-0">
                  {row.groupSize} propiedad{row.groupSize !== 1 ? 'es' : ''}
                </span>
              </div>
            );
          }

          // ── Regular single expense row ──────────────────────────────────────
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-800">{info.getValue()}</span>
              {kind && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  kind === 'Recurrente'
                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : kind === 'Multa cancelación'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}>
                  {kind}
                </span>
              )}
              {row.adjustment_id && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-50 text-amber-800 border-amber-200"
                  title="Generado automáticamente desde un cobro por daño en la reserva"
                >
                  Daño huésped
                </span>
              )}
              {row.booking_id && !row.adjustment_id && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 font-mono"
                  title="Gasto vinculado a una reserva"
                >
                  Reserva
                </span>
              )}
            </div>
          );
        },
      }),
      helper.accessor('bank_account_id', {
        header: 'Cuenta',
        enableSorting: false,
        cell: info => {
          const accountId = info.getValue() as string | null | undefined;
          if (!accountId) return <span className="text-slate-400 text-xs">—</span>;
          const account = accountMap.get(accountId);
          if (!account) return <span className="text-slate-400 text-xs font-mono">{accountId.slice(0, 8)}…</span>;
          return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
              account.is_cash
                ? 'bg-emerald-50 text-emerald-700'
                : account.is_credit
                  ? 'bg-purple-50 text-purple-700'
                  : 'bg-blue-50 text-blue-700'
            }`}>
              {account.name}
            </span>
          );
        },
      }),
      helper.accessor('date', {
        header: 'Fecha',
        meta: { className: 'text-slate-500 whitespace-nowrap' },
        cell: info => formatDateDisplay(info.getValue() as string),
      }),
      helper.accessor('description', {
        header: 'Descripción',
        enableSorting: false,
        meta: { className: 'text-slate-500 max-w-[200px] truncate' },
        cell: info => {
          const row = info.row.original;
          // Cleaning group header: show cleaner name + payout date
          if (row.isGroup && (isCleaning(row) || (row.children ?? []).some(c => isCleaning(c)))) {
            return (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-sky-800">{row.vendor || '—'}</span>
                <span className="text-slate-400 text-[11px]">· {formatDateDisplay(row.date)}</span>
              </span>
            );
          }
          // Cleaning child: show done date parsed from description
          if (row.isChild && isCleaning(row)) {
            const parsed = parseCleaningDesc(row.description);
            return (
              <span className="text-[11px] text-slate-500 pl-7">
                {parsed
                  ? formatDateDisplay(parsed.doneDate)
                  : cleanDamageDescription(row.description) || ''}
              </span>
            );
          }
          if (row.isChild) return <span className="text-xs text-slate-400 pl-7">{formatCurrency(row.amount)}</span>;
          const isCleaningGroup = isCleaning(row) || (row.children ?? []).some(c => isCleaning(c));
          return (
            <span className="flex items-center gap-1.5">
              <span className="truncate">{cleanDamageDescription(info.getValue() as string | null) || '—'}</span>
              {/* For non-grouped single expenses that carry a group id, show a badge */}
              {!row.isGroup && row.expense_group_id && !isCleaningGroup && (
                <span
                  title="Gasto compartido entre varias propiedades"
                  className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-100 text-violet-700 flex-shrink-0"
                >
                  Compartido
                </span>
              )}
              {!row.isGroup && row.expense_group_id && isCleaningGroup && (
                <span
                  title="Parte de una liquidación de aseo"
                  className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-cyan-100 text-cyan-700 flex-shrink-0"
                >
                  Liquidación
                </span>
              )}
            </span>
          );
        },
      }),
      helper.accessor('vendor', {
        header: 'Proveedor',
        enableSorting: false,
        meta: { className: 'text-slate-600 max-w-[180px] truncate' },
        cell: info => {
          const row = info.row.original;
          if (row.isChild) return null;
          const value = info.getValue() as string | null | undefined;
          return (
            <span className="truncate" title={value ?? undefined}>
              {value || '—'}
            </span>
          );
        },
      }),
      helper.accessor('amount', {
        header: 'Monto',
        meta: { align: 'right' },
        sortingFn: 'basic',
        cell: info => {
          const row = info.row.original;
          if (row.isChild && !isCleaning(row)) return null; // amount shown in description cell for non-cleaning children
          if (row.isChild) {
            // Cleaning children: show amount here (description shows done date instead)
            return <span className="font-mono text-xs font-semibold text-red-600">{formatCurrency(info.getValue())}</span>;
          }
          return (
            <span className={`font-semibold ${
              row.isGroup && isCleaning(row) ? 'text-sky-700' :
              row.isGroup ? 'text-violet-700' : 'text-slate-800'
            }`}>
              {formatCurrency(info.getValue())}
            </span>
          );
        },
      }),
      helper.accessor('status', {
        header: 'Estado',
        meta: { align: 'center' },
        cell: info => {
          const row = info.row.original;
          if (row.isChild) return null;
          // Synthetic entries (fees/fines) don't have a real payment status
          if (isSynthetic(row.id)) return null;
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

    if (onView || onEdit || onEditGroup || onDeleteGroup || onDelete) {
      cols.push(
        helper.display({
          id: 'actions',
          header: 'Acciones',
          enableSorting: false,
          meta: { align: 'center', className: 'w-32 whitespace-nowrap' },
          cell: info => {
            const row = info.row.original;

            // Group header: Edit + View + Delete group
            if (row.isGroup) {
              return (
                <div className="flex items-center justify-center gap-1">
                  {onEditGroup && (
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onEditGroup(row)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                      title="Editar grupo (estado, fecha, cuenta, montos)"
                      aria-label="Editar grupo de gastos"
                    >
                      <Pencil className="w-4 h-4" />
                    </motion.button>
                  )}
                  {onView && (
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onView(row)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Ver detalle del grupo"
                      aria-label="Ver detalle del grupo"
                    >
                      <FileText className="w-4 h-4" />
                    </motion.button>
                  )}
                  {onDeleteGroup && (
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onDeleteGroup(row)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Eliminar grupo completo"
                      aria-label="Eliminar grupo de gastos"
                    >
                      <Trash2 className="w-4 h-4" />
                    </motion.button>
                  )}
                </div>
              );
            }

            // Child rows: View + Delete only (no Edit — use the group header to avoid discrepancies)
            if (row.isChild) {
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
                </div>
              );
            }

            // Regular (ungrouped) rows: all actions
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
  }, [accountMap, expandedGroups, propertyMap, onDelete, onDeleteGroup, onEdit, onEditGroup, onView]);

  return (
    <DataTable<GroupedExpense>
      columns={columns}
      data={groupedExpenses}
      loading={loading}
      showSearch
      searchPlaceholder="Buscar por categoría, tipo o descripción…"
      defaultPageSize={25}
      skeletonRows={5}
      emptyIcon=""
      emptyTitle="Sin gastos registrados"
      emptyDescription="Registra tu primer gasto usando el botón de arriba."
      getRowClassName={row => {
        const cleaningRow = isCleaning(row) || (row.isGroup && (row.children ?? []).some(c => isCleaning(c)));
        if (row.isChild) return cleaningRow
          ? 'bg-sky-50/60 border-l-2 border-sky-300'
          : 'bg-violet-50/50 border-l-2 border-violet-200';
        if (row.isGroup) return cleaningRow ? 'bg-sky-50/30' : 'bg-violet-50/20';
        return '';
      }}
      renderFooter={filteredData => {
        // Sum only top-level rows (groups + ungrouped), not child rows, to avoid double-counting
        const total = filteredData.filter(e => !e.isChild).reduce((sum, e) => sum + e.amount, 0);
        const visibleCount = filteredData.filter(e => !e.isChild).length;
        const hasActions = !!(onDelete || onEdit || onView);
        const colSpanLeft = hasActions ? 5 : 5;
        const colSpanRight = hasActions ? 2 : 1;
        return (
          <tr className="border-t bg-slate-50">
            <td colSpan={colSpanLeft} className="px-5 py-4 font-semibold text-slate-700">
              Total ({visibleCount} registro{visibleCount !== 1 ? 's' : ''})
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

