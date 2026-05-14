import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowData,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

// Extend TanStack meta types for per-column alignment and extra td classes
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'center' | 'right';
    className?: string;
  }
}

const PAGE_SIZES = [10, 25, 50, 100];

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ChevronUp size={12} className="text-blue-500 flex-shrink-0" />;
  if (sorted === 'desc') return <ChevronDown size={12} className="text-blue-500 flex-shrink-0" />;
  return <ChevronsUpDown size={12} className="text-slate-300 flex-shrink-0" />;
}

interface DataTableProps<T extends object> {
  columns: ColumnDef<T, any>[];
  data: T[];
  loading?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  defaultPageSize?: number;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  renderFooter?: (filteredData: T[]) => React.ReactNode;
  skeletonRows?: number;
  /** Optional extra CSS classes per row based on the row data. */
  getRowClassName?: (row: T) => string;
}

export default function DataTable<T extends object>({
  columns,
  data,
  loading = false,
  showSearch = true,
  searchPlaceholder = 'Buscar…',
  defaultPageSize = 10,
  emptyIcon = '',
  emptyTitle = 'Sin datos',
  emptyDescription,
  renderFooter,
  skeletonRows = 5,
  getRowClassName,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: defaultPageSize });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (v: string) => {
      setGlobalFilter(v);
      setPagination(p => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false, // prevent page reset when data changes (e.g. expanding a group row)
  });

  const filteredRows = table.getFilteredRowModel().rows;
  const pageRows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const { pageIndex, pageSize } = table.getState().pagination;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border rounded-xl shadow-sm overflow-hidden"
    >
      {/* Search bar */}
      {showSearch && (
        <div className="px-5 py-3 border-b bg-slate-50 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
            </span>
            <input
              type="text"
              value={globalFilter}
              onChange={e => {
                setGlobalFilter(e.target.value);
                setPagination(p => ({ ...p, pageIndex: 0 }));
              }}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            />
          </div>
          {globalFilter && (
            <button
              onClick={() => {
                setGlobalFilter('');
                setPagination(p => ({ ...p, pageIndex: 0 }));
              }}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              ✕ Limpiar
            </button>
          )}
          <span className="text-xs text-slate-400 ml-auto">
            {filteredRows.length} resultado{filteredRows.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Table — overflow-x para que columnas sobrantes hagan scroll horizontal en mobile */}
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm min-w-[640px] sm:min-w-0">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="border-b bg-slate-50">
                {headerGroup.headers.map(header => {
                  const canSort = header.column.getCanSort();
                  const align = header.column.columnDef.meta?.align ?? 'left';
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={[
                        'px-5 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap select-none',
                        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                        canSort ? 'cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && <SortIcon sorted={header.column.getIsSorted()} />}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div
                        className="h-4 bg-slate-100 rounded animate-pulse"
                        style={{ width: `${50 + (j % 5) * 8}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16 text-slate-400">
                  <div className="space-y-2">
                    {emptyIcon && <div className="text-3xl">{emptyIcon}</div>}
                    <p className="font-medium">{emptyTitle}</p>
                    {emptyDescription && <div className="text-sm">{emptyDescription}</div>}
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map(row => (
                <tr key={row.id} className={['hover:bg-slate-50 transition-colors', getRowClassName ? getRowClassName(row.original) : ''].filter(Boolean).join(' ')}>
                  {row.getVisibleCells().map(cell => {
                    const align = cell.column.columnDef.meta?.align ?? 'left';
                    const extraClass = cell.column.columnDef.meta?.className ?? '';
                    return (
                      <td
                        key={cell.id}
                        className={[
                          'px-5 py-3.5',
                          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '',
                          extraClass,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>

          {!loading && filteredRows.length > 0 && renderFooter && (
            <tfoot>{renderFooter(filteredRows.map(r => r.original))}</tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {!loading && pageCount > 1 && (
        <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-t bg-slate-50 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Mostrar</span>
            <select
              value={pageSize}
              onChange={e => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
              className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {PAGE_SIZES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">por página</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-2">
              {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, filteredRows.length)}{' '}
              de {filteredRows.length}
            </span>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1.5 rounded-md hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
              const start = Math.max(0, Math.min(pageIndex - 2, pageCount - 5));
              const page = start + i;
              if (page >= pageCount) return null;
              return (
                <button
                  key={page}
                  onClick={() => table.setPageIndex(page)}
                  className={`w-8 h-8 text-xs rounded-md transition-colors ${
                    page === pageIndex
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {page + 1}
                </button>
              );
            })}
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1.5 rounded-md hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Página siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
