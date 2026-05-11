'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { listVendors, createVendor, updateVendor, deleteVendor, type Vendor } from '@/services/vendors';
import { listBankAccounts } from '@/services/bankAccounts';
import {
  listAllCleanings,
  listAllCleaningsEnriched,
  computeCleanerBalances,
  payoutCleanerConsolidated,
  getLooseCleanerSuppliesTotals,
  type BookingCleaning,
} from '@/services/cleanings';
import {
  listCleanerGroups,
  createCleanerGroup,
  deleteCleanerGroup,
  setCleanerGroupMembership,
  type CleanerGroup,
} from '@/services/cleanerGroups';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { Pencil, UserMinus, Download } from 'lucide-react';
import { exportAseoToCsv, exportAseoToExcel, exportAseoToPdf, type AseoExportRow } from '@/services/export';
import { TagChip, NewTagInline } from './aseo/CleanerTagControls';
import NewCleanerModal from './aseo/NewCleanerModal';
import DetailModal from './aseo/DetailModal';
import PayoutModal from './aseo/PayoutModal';
import EditCleanerModal from './aseo/EditCleanerModal';
import ConfirmDeleteModal from './aseo/ConfirmDeleteModal';

export default function AseoClient(): JSX.Element {
  const [cleaners, setCleaners] = useState<Vendor[]>([]);
  const [cleanings, setCleanings] = useState<BookingCleaning[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [groups, setGroups] = useState<CleanerGroup[]>([]);
  const [looseSupplies, setLooseSupplies] = useState<Map<string, { amount: number; count: number }>>(new Map());
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState<{ name: string; contact: string; tagIds: string[] }>({ name: '', contact: '', tagIds: [] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Vendor | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);

  // Historial state
  const [histDateFrom, setHistDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [histDateTo, setHistDateTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const histDateToRef = useRef<HTMLInputElement>(null);
  const histDateToTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const histFromWasEmptyRef = useRef(false);
  const [histCleanerIds, setHistCleanerIds] = useState<string[]>([]);
  const [exporting, setExporting]       = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, cRes, bRes, gRes, lRes] = await Promise.all([
      listVendors('cleaner'),
      listAllCleanings(),
      listBankAccounts(),
      listCleanerGroups(),
      getLooseCleanerSuppliesTotals(),
    ]);
    if (vRes.data) setCleaners(vRes.data);
    if (cRes.data) setCleanings(cRes.data);
    if (bRes.data) setBanks(bRes.data);
    if (gRes.data) setGroups(gRes.data);
    if (lRes.data) setLooseSupplies(lRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const balances = useMemo(() => computeCleanerBalances(cleanings), [cleanings]);

  /** Balance combinado: cleanings + insumos sueltos pendientes (vendor_id=cleaner). */
  const combinedBalances = useMemo(() => {
    const out = new Map<string, { pending_amount: number; loose_amount: number; loose_count: number; total: number }>();
    const ids = new Set<string>([...balances.keys(), ...looseSupplies.keys()]);
    for (const id of ids) {
      const b = balances.get(id);
      const loose = looseSupplies.get(id);
      const cleaningTotal = b ? b.total_owed : 0;
      const looseAmount = loose?.amount ?? 0;
      out.set(id, {
        pending_amount: cleaningTotal,
        loose_amount: looseAmount,
        loose_count: loose?.count ?? 0,
        total: cleaningTotal + looseAmount,
      });
    }
    return out;
  }, [balances, looseSupplies]);

  // Mapa cleanerId -> tags (derivado de groups[].member_ids)
  const cleanerTagsMap = useMemo(() => {
    const m = new Map<string, CleanerGroup[]>();
    for (const g of groups) {
      for (const cid of g.member_ids) {
        const arr = m.get(cid) ?? [];
        arr.push(g);
        m.set(cid, arr);
      }
    }
    return m;
  }, [groups]);

  const filteredCleaners = useMemo(() => {
    if (tagFilters.length === 0) return cleaners;
    const showUntagged = tagFilters.includes('__none__');
    return cleaners.filter(c => {
      const cTags = cleanerTagsMap.get(c.id) ?? [];
      if (showUntagged && cTags.length === 0) return true;
      return cTags.some(t => tagFilters.includes(t.id));
    });
  }, [cleaners, tagFilters, cleanerTagsMap]);

  const cleanerMap = useMemo(() => new Map(cleaners.map(c => [c.id, c])), [cleaners]);

  const filteredHistCleanings = useMemo(() => {
    return cleanings
      .filter(c => {
        if (histCleanerIds.length > 0 && c.cleaner_id && !histCleanerIds.includes(c.cleaner_id)) return false;
        if (histDateFrom && c.done_date && c.done_date < histDateFrom) return false;
        if (histDateTo && c.done_date && c.done_date > histDateTo) return false;
        return true;
      })
      .sort((a, b) => {
        const da = a.done_date ?? a.created_at ?? '';
        const db = b.done_date ?? b.created_at ?? '';
        return db.localeCompare(da);
      });
  }, [cleanings, histCleanerIds, histDateFrom, histDateTo]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio.'); return; }
    setSaving(true);
    const res = await createVendor({
      name: form.name.trim(),
      kind: 'cleaner',
      contact: form.contact.trim() || null,
      notes: null,
      active: true,
      category: null,
      default_amount: null,
      day_of_month: null,
      is_variable: false,
      start_year_month: null,
    });
    if (res.error || !res.data) { setSaving(false); setErr(res.error ?? 'Error'); toast.error(res.error ?? 'No se pudo crear el personal'); return; }
    if (form.tagIds.length > 0) {
      await setCleanerGroupMembership(res.data.id, form.tagIds);
    }
    setSaving(false);
    setNewModal(false);
    setForm({ name: '', contact: '', tagIds: [] });
    setErr(null);
    toast.success('Personal de aseo creado');
    await load();
  };

  const handleCreateTag = async (name: string): Promise<string | null> => {
    const res = await createCleanerGroup(name);
    if (res.error || !res.data) return null;
    await load();
    return res.data.id;
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('¿Eliminar etiqueta? Las personas seguirán existiendo.')) return;
    const res = await deleteCleanerGroup(id);
    if (res?.error) { toast.error(res.error); return; }
    toast.success('Etiqueta eliminada');
    setTagFilters(prev => prev.filter(t => t !== id));
    await load();
  };

  const handleSaveEdit = async (
    cleaner: Vendor,
    patch: { name: string; contact: string; active: boolean; tagIds: string[] },
  ): Promise<string | null> => {
    const res = await updateVendor(cleaner.id, {
      name: patch.name.trim(),
      contact: patch.contact.trim() || null,
      active: patch.active,
    });
    if (res.error) return res.error;
    await setCleanerGroupMembership(cleaner.id, patch.tagIds);
    await load();
    return null;
  };

  const handleConfirmDelete = async (c: Vendor): Promise<string | null> => {
    // Hard delete sólo si no tiene aseos asociados; si los tiene, soft delete.
    const hasCleanings = cleanings.some(cl => cl.cleaner_id === c.id);
    if (hasCleanings) {
      const res = await updateVendor(c.id, { active: false });
      if (res.error) return res.error;
    } else {
      const res = await deleteVendor(c.id);
      if (res.error) return res.error;
    }
    setConfirmDelete(null);
    await load();
    return null;
  };

  // Bloque 9: NO marcamos paid individual. El paid se crea junto con el expense
  // a través de payoutCleanerConsolidated (botón "Liquidar"). Mantener
  // consistencia entre booking_cleanings.status='paid' y un expense real.

  const handleExport = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(true);
    setExportMenuOpen(false);
    const res = await listAllCleaningsEnriched({
      from: histDateFrom || undefined,
      to:   histDateTo   || undefined,
      cleanerIds: histCleanerIds.length > 0 ? histCleanerIds : undefined,
    });
    if (res.error || !res.data) {
      toast.error('Error al cargar historial para exportar');
      setExporting(false);
      return;
    }
    const periodLabel = [histDateFrom, histDateTo].filter(Boolean).join('_al_') || 'todos';
    const rows: AseoExportRow[] = res.data.map(r => ({
      cleaner_name:  r.cleaner_id ? (cleanerMap.get(r.cleaner_id)?.name ?? '—') : '—',
      done_date:     r.done_date,
      booking_code:  r.booking_code,
      property_name: r.property_name,
      guest_name:    r.guest_name,
      check_in:      r.check_in,
      check_out:     r.check_out,
      fee:           r.fee,
      status:        r.status,
      paid_date:     r.paid_date,
    }));
    if (format === 'csv')   exportAseoToCsv(rows, periodLabel);
    else if (format === 'excel') exportAseoToExcel(rows, periodLabel);
    else                    exportAseoToPdf(rows, periodLabel);
    setExporting(false);
  };

  const totalOwed = useMemo(
    () => Array.from(balances.values()).reduce((s, b) => s + b.total_owed, 0),
    [balances],
  );
  const totalPending = useMemo(
    () => cleanings.filter(c => c.status !== 'paid').length,
    [cleanings],
  );
  const totalDone = useMemo(
    () => cleanings.filter(c => c.status === 'done' && !c.paid_date).length,
    [cleanings],
  );

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">🧹 Aseo</h1>
          <p className="text-sm text-slate-500">Personal, saldos adeudados y liquidación semanal.</p>
        </div>
        <button
          onClick={() => setNewModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm inline-flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Nueva persona
        </button>
      </header>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Personal activo" value={cleaners.filter(c => c.active).length.toString()} tone="slate" />
        <KPICard label="Aseos pendientes" value={totalPending.toString()} tone="amber" />
        <KPICard label="Hechos sin pagar" value={totalDone.toString()} tone="blue" />
        <KPICard label="Total adeudado" value={formatCurrency(totalOwed)} tone="red" highlight />
      </div>

      {/* Bloque 2: filtros por etiqueta (multi-select) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Etiqueta:</span>
        {tagFilters.length > 0 && (
          <TagChip active onClick={() => setTagFilters([])} label={`Limpiar filtros (${filteredCleaners.length})`} color="#64748b" />
        )}
        {tagFilters.length === 0 && (
          <TagChip active={false} onClick={() => {}} label={`Todos (${cleaners.length})`} />
        )}
        <TagChip
          active={tagFilters.includes('__none__')}
          onClick={() => setTagFilters(prev => prev.includes('__none__') ? prev.filter(t => t !== '__none__') : [...prev, '__none__'])}
          label="Sin etiqueta"
        />
        {groups.map(g => (
          <TagChip
            key={g.id}
            active={tagFilters.includes(g.id)}
            onClick={() => setTagFilters(prev => prev.includes(g.id) ? prev.filter(t => t !== g.id) : [...prev, g.id])}
            label={`${g.name} (${g.member_ids.length})`}
            color={g.color ?? undefined}
            onDelete={() => handleDeleteTag(g.id)}
          />
        ))}
        <NewTagInline onCreateTag={handleCreateTag} />
      </div>

      {/* Bloque 9: explicación del flujo de liquidación */}
      <div className="mb-6 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900">
        <p>
          <strong>📋 Flujo:</strong> los aseos pasan de <em>Pendiente</em> → <em>Hecho</em>{' '}
          (operativo, sin afectar contabilidad) → <em>Liquidado</em>. El gasto en{' '}
          <a href="/expenses" className="underline font-semibold">/expenses</a> y el descuento en la
          cuenta bancaria se crean <strong>solo al "💸 Liquidar"</strong>, no antes. Hasta entonces, el monto
          aparece como adeudado pero no como gasto del negocio.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando…</p>
      ) : cleaners.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">🧹</div>
          <p className="text-slate-600 font-medium mb-1">Aún no has agregado personal de aseo</p>
          <p className="text-xs text-slate-500 mb-4">Asigna trabajadoras de limpieza para llevar cuenta de lo que les debes.</p>
          <button onClick={() => setNewModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            Agregar primera persona
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCleaners.map(c => {
            const b = balances.get(c.id);
            const cb = combinedBalances.get(c.id);
            const cleaningOwed = b?.total_owed ?? 0;
            const looseOwed = cb?.loose_amount ?? 0;
            const looseCount = cb?.loose_count ?? 0;
            const owed = cleaningOwed + looseOwed;
            const canPay = (b?.done_unpaid_count ?? 0) > 0 || looseCount > 0;
            const cTags = cleanerTagsMap.get(c.id) ?? [];
            return (
              <motion.div
                key={c.id}
                whileHover={{ y: -2 }}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                  owed > 0 ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <div className={`px-5 py-4 border-b ${owed > 0 ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-white ${
                        owed > 0 ? 'bg-red-500' : 'bg-slate-400'
                      }`}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 leading-tight">{c.name}</div>
                        <div className="text-xs text-slate-500">{c.contact ?? 'sin contacto'}</div>
                        {cTags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {cTags.map(t => (
                              <span
                                key={t.id}
                                className="px-1.5 py-0.5 text-[10px] font-semibold rounded"
                                style={{ backgroundColor: (t.color ?? '#64748b') + '22', color: t.color ?? '#475569' }}
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {!c.active && <span className="text-xs text-slate-400">inactivo</span>}
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => setEditing(c)}
                        className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700"
                        aria-label="Editar"
                      >
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        title="Retirar persona"
                        onClick={() => setConfirmDelete(c)}
                        className="w-7 h-7 rounded hover:bg-amber-100 flex items-center justify-center text-slate-400 hover:text-amber-700"
                        aria-label="Retirar persona"
                      >
                        <UserMinus size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-amber-50 rounded-lg py-2">
                      <div className="text-lg font-bold text-amber-700">{b?.pending_count ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Pendientes</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg py-2">
                      <div className="text-lg font-bold text-blue-700">{b?.done_unpaid_count ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold">Hechos s/pagar</div>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-2 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 uppercase">Total adeudado</span>
                    <span className={`text-xl font-bold ${owed > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {formatCurrency(owed)}
                    </span>
                  </div>
                  {looseCount > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-1">
                      <span>🧴 {looseCount} compra{looseCount === 1 ? '' : 's'} de insumos pendientes</span>
                      <span className="font-semibold">{formatCurrency(looseOwed)}</span>
                    </div>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex gap-2">
                  <button
                    onClick={() => setDetail(c)}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                  >
                    Ver historial
                  </button>
                  <button
                    onClick={() => setPayoutTarget(c)}
                    disabled={!canPay}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    title={canPay ? 'Consolidar pago y generar gasto' : 'No hay aseos hechos sin pagar'}
                  >
                    💸 Liquidar
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Historial Global de Aseo ──────────────────────────────────────── */}
      {!loading && cleanings.length > 0 && (
        <div className="mt-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-slate-800">📋 Historial de Aseo</h2>
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(v => !v)}
                disabled={exporting || filteredHistCleanings.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm"
              >
                <Download size={15} />
                {exporting ? 'Exportando…' : 'Exportar'}
              </button>
              {exportMenuOpen && (
                <div
                  className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 min-w-[168px] overflow-hidden"
                  onMouseLeave={() => setExportMenuOpen(false)}
                >
                  {(['csv', 'excel', 'pdf'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => handleExport(fmt)}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {fmt === 'csv' ? '📄 CSV' : fmt === 'excel' ? '📊 Excel (.xls)' : '🖨️ PDF / Imprimir'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-start p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Período:</span>
              <input
                type="date"
                value={histDateFrom}
                max={histDateTo || undefined}
                onFocus={() => { histFromWasEmptyRef.current = !histDateFrom; }}
                onChange={e => {
                  const val = e.target.value;
                  setHistDateFrom(val);
                  if (!histFromWasEmptyRef.current) return;
                  if (histDateToTimerRef.current) clearTimeout(histDateToTimerRef.current);
                  if (val) {
                    histDateToTimerRef.current = setTimeout(() => {
                      try { histDateToRef.current?.showPicker(); } catch { histDateToRef.current?.focus(); }
                    }, 200);
                  }
                }}
                className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-400 text-xs">—</span>
              <input
                ref={histDateToRef}
                type="date"
                value={histDateTo}
                min={histDateFrom || undefined}
                onChange={e => setHistDateTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {(histDateFrom || histDateTo) && (
                <button
                  onClick={() => { setHistDateFrom(''); setHistDateTo(''); }}
                  className="text-xs text-blue-600 underline"
                >
                  Ver todos
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Personal:</span>
              {histCleanerIds.length > 0 && (
                <button onClick={() => setHistCleanerIds([])} className="text-xs text-blue-600 underline">
                  Todos
                </button>
              )}
              {cleaners.map(c => (
                <button
                  key={c.id}
                  onClick={() => setHistCleanerIds(prev =>
                    prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                  )}
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
                    histCleanerIds.includes(c.id)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {filteredHistCleanings.length} registro{filteredHistCleanings.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                Total: {formatCurrency(filteredHistCleanings.reduce((s, c) => s + c.fee, 0))}
              </span>
            </div>
            {filteredHistCleanings.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">Sin registros para el período seleccionado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-slate-50">
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Personal</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Fecha hecho</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Valor</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Liquidado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistCleanings.slice(0, 200).map(c => {
                      const cleanerName = c.cleaner_id ? (cleanerMap.get(c.cleaner_id)?.name ?? '—') : '—';
                      const statusLabel = c.status === 'paid' ? '✅ Liquidado' : c.status === 'done' ? '🔵 Hecho' : '🟡 Pendiente';
                      return (
                        <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-800">{cleanerName}</td>
                          <td className="px-4 py-2.5 text-slate-600">{c.done_date ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-700">{formatCurrency(c.fee)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{statusLabel}</td>
                          <td className="px-4 py-2.5 text-slate-500">{c.paid_date ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredHistCleanings.length > 200 && (
                  <p className="text-center text-xs text-slate-400 py-3 border-t">
                    Mostrando 200 de {filteredHistCleanings.length} registros. Usa el exportador para ver todos.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {newModal && (
          <NewCleanerModal
            form={form}
            setForm={setForm}
            saving={saving}
            err={err}
            groups={groups}
            onCreateTag={handleCreateTag}
            onClose={() => setNewModal(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <DetailModal
            cleaner={detail}
            cleanings={cleanings.filter(c => c.cleaner_id === detail.id)}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payoutTarget && (
          <PayoutModal
            cleaner={payoutTarget}
            balance={balances.get(payoutTarget.id)}
            looseAmount={combinedBalances.get(payoutTarget.id)?.loose_amount ?? 0}
            looseCount={combinedBalances.get(payoutTarget.id)?.loose_count ?? 0}
            banks={banks}
            onClose={() => setPayoutTarget(null)}
            onConfirm={async (args) => {
              const res = await payoutCleanerConsolidated({
                cleanerId: payoutTarget.id,
                cleanerName: payoutTarget.name,
                ...args,
              });
              if (res.error) return res.error;
              setPayoutTarget(null);
              await load();
              return null;
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editing && (
          <EditCleanerModal
            cleaner={editing}
            initialTagIds={cleanerTagsMap.get(editing.id)?.map(g => g.id) ?? []}
            groups={groups}
            onClose={() => setEditing(null)}
            onSave={async (patch) => {
              const err = await handleSaveEdit(editing, patch);
              if (!err) setEditing(null);
              return err;
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDeleteModal
            cleaner={confirmDelete}
            hasCleanings={cleanings.some(cl => cl.cleaner_id === confirmDelete.id)}
            onClose={() => setConfirmDelete(null)}
            onConfirm={() => handleConfirmDelete(confirmDelete)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function KPICard({ label, value, tone, highlight }: { label: string; value: string; tone: 'slate'|'amber'|'blue'|'red'; highlight?: boolean }) {
  const color = {
    slate: 'text-slate-800',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    red: 'text-red-600',
  }[tone];
  return (
    <div className={`bg-white rounded-xl p-4 border ${highlight ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'}`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl lg:text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
