'use client';
/**
 * FinancialLedger — detailed transaction table for the "Ingresos vs Egresos" tab.
 *
 * Shows all income and expense movements in a paginated, filterable table.
 * Columns: Fecha · Concepto · Canal · Categoría · Cuenta · Monto
 *
 * Features:
 *   - Filter by type: Todos / Ingresos / Egresos
 *   - Text search across concept, bookingCode, guestName, category
 *   - Pagination (25 rows per page)
 *   - Summary footer: total income, total expenses, net
 *   - CSV export
 *   - Synthetic (fee/fine) entries rendered with muted style + info badge
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { FinancialTransaction } from '@/services/transactions';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  transactions: FinancialTransaction[];
  loading?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;


// ─── CSV helpers ─────────────────────────────────────────────────────────────

function toCSV(rows: FinancialTransaction[]): string {
  const header = ['Fecha', 'Concepto', 'Canal', 'Categoría', 'Tipo', 'Cuenta', 'Monto', 'Sintético'];
  const lines = rows.map(r => [
    r.date,
    `"${r.concept.replace(/"/g, '""')}"`,
    r.channel ?? '',
    r.category,
    r.type === 'income' ? 'Ingreso' : 'Egreso',
    r.bankAccountName ?? '',
    r.signedAmount.toFixed(2),
    r.isSynthetic ? 'Sí' : 'No',
  ].join(','));
  return [header.join(','), ...lines].join('\n');
}

function downloadCSV(rows: FinancialTransaction[]) {
  const csv = toCSV(rows);
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LedgerSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 bg-slate-100 rounded-lg" />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FinancialLedger({ transactions, loading }: Props) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (typeFilter === 'income')  rows = rows.filter(r => r.type === 'income');
    if (typeFilter === 'expense') rows = rows.filter(r => r.type === 'expense');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.concept.toLowerCase().includes(q) ||
        (r.bookingCode ?? '').toLowerCase().includes(q) ||
        (r.guestName ?? '').toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.bankAccountName ?? '').toLowerCase().includes(q) ||
        (r.channel ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [transactions, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Summaries over filtered set
  const totalIncome  = filtered.filter(r => r.type === 'income' && !r.isSynthetic).reduce((s, r) => s + r.amount, 0);
  const totalExpense = filtered.filter(r => r.type === 'expense' && !r.isSynthetic).reduce((s, r) => s + r.amount, 0);
  const totalFees    = filtered.filter(r => r.isSynthetic && r.category === 'Fee de canal').reduce((s, r) => s + r.amount, 0);
  const net          = totalIncome - totalExpense;

  const fmtDate = (d: string) => formatDateDisplay(d);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleTypeFilter = (v: typeof typeFilter) => {
    setTypeFilter(v);
    setPage(1);
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h3 className="font-bold text-slate-800">Movimientos del período</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {transactions.length} movimiento{transactions.length !== 1 ? 's' : ''} en total
            {filtered.length !== transactions.length && ` · ${filtered.length} filtrado${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            {([
              ['all', 'Todos'],
              ['income', 'Ingresos'],
              ['expense', 'Egresos'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => handleTypeFilter(v)}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  typeFilter === v
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar…"
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none w-40"
          />
          {/* Export */}
          <button
            onClick={() => downloadCSV(filtered)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            title="Exportar CSV"
          >
            ↓ CSV
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="p-5"><LedgerSkeleton /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          {search ? 'No hay movimientos que coincidan con la búsqueda.' : 'Sin movimientos en este período.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 whitespace-nowrap">Fecha</th>
                <th className="px-4 py-3">Concepto</th>
                <th className="px-4 py-3 whitespace-nowrap">Canal</th>
                <th className="px-4 py-3 whitespace-nowrap">Categoría</th>
                <th className="px-4 py-3 whitespace-nowrap">Cuenta</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((tx, i) => (
                <motion.tr
                  key={tx.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className={`group transition-colors hover:bg-slate-50/60 ${tx.isSynthetic ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono text-xs">
                    {fmtDate(tx.date)}
                  </td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`truncate ${tx.type === 'income' ? 'text-slate-800' : 'text-slate-700'}`}>
                        {tx.concept}
                      </span>
                      {tx.isSynthetic && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-400 border border-slate-200 shrink-0">
                          info
                        </span>
                      )}
                      {tx.notes && (
                        <span className="text-xs text-slate-400 truncate">{tx.notes}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-xs">
                    {tx.channel ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      tx.type === 'income'
                        ? 'bg-emerald-50 text-emerald-700'
                        : tx.isSynthetic
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-rose-50 text-rose-700'
                    }`}>
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap text-xs">
                    {tx.bankAccountName ?? (tx.isSynthetic ? <span className="italic">Plataforma</span> : '—')}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap font-semibold tabular-nums">
                    <span className={
                      tx.type === 'income'
                        ? 'text-emerald-600'
                        : tx.isSynthetic
                          ? 'text-slate-400'
                          : 'text-rose-600'
                    }>
                      {tx.type === 'income' ? '+' : '−'}{formatCurrency(tx.amount)}
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Mostrando {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >‹ Ant</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const pNum = i + 1;
              return (
                <button
                  key={pNum}
                  onClick={() => setPage(pNum)}
                  className={`px-2 py-1 rounded border transition-colors ${
                    pNum === safePage
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >{pNum}</button>
              );
            })}
            {totalPages > 7 && safePage < totalPages - 3 && <span className="px-1">…</span>}
            {totalPages > 7 && (
              <button
                onClick={() => setPage(totalPages)}
                className={`px-2 py-1 rounded border transition-colors ${
                  safePage === totalPages
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >{totalPages}</button>
            )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >Sig ›</button>
          </div>
        </div>
      )}

      {/* ── Summary footer ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border-t border-slate-100">
        {[
          { label: 'Total ingresos', value: totalIncome, color: 'text-emerald-600', sign: '+' },
          { label: 'Total egresos',  value: totalExpense, color: 'text-rose-600',   sign: '−' },
          { label: 'Neto',           value: Math.abs(net), color: net >= 0 ? 'text-emerald-700' : 'text-rose-700', sign: net >= 0 ? '+' : '−' },
          { label: 'Fees canal', value: totalFees, color: 'text-slate-400', sign: '' },
        ].map(item => (
          <div key={item.label} className="px-5 py-3 border-r last:border-r-0 border-slate-100">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{item.label}</p>
            <p className={`text-base font-extrabold tabular-nums mt-0.5 ${item.color}`}>
              {item.sign}{formatCurrency(item.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
