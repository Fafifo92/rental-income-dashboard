'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listVendors, createVendor, updateVendor, deleteVendor, type Vendor } from '@/services/vendors';
import { listBankAccounts } from '@/services/bankAccounts';
import {
  listAllCleanings,
  computeCleanerBalances,
  payoutCleanerConsolidated,
  listCleaningsByCleaner,
  getLooseCleanerSuppliesTotals,
  listCleanerLooseSupplies,
  type BookingCleaning,
  type CleaningHistoryRow,
  type LooseSupplyRow,
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
import { useBackdropClose } from '@/lib/useBackdropClose';
import { Pencil, UserMinus } from 'lucide-react';
import { todayISO } from '@/lib/dateUtils';

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
    if (res.error || !res.data) { setSaving(false); setErr(res.error ?? 'Error'); return; }
    if (form.tagIds.length > 0) {
      await setCleanerGroupMembership(res.data.id, form.tagIds);
    }
    setSaving(false);
    setNewModal(false);
    setForm({ name: '', contact: '', tagIds: [] });
    setErr(null);
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
    await deleteCleanerGroup(id);
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

function NewCleanerModal({
  form, setForm, saving, err, groups, onCreateTag, onClose, onCreate,
}: {
  form: { name: string; contact: string; tagIds: string[] };
  setForm: (f: { name: string; contact: string; tagIds: string[] }) => void;
  saving: boolean;
  err: string | null;
  groups: CleanerGroup[];
  onCreateTag: (name: string) => Promise<string | null>;
  onClose: () => void;
  onCreate: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  const toggleTag = (id: string) => {
    setForm({
      ...form,
      tagIds: form.tagIds.includes(id)
        ? form.tagIds.filter(g => g !== id)
        : [...form.tagIds, id],
    });
  };

  const addTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    const id = await onCreateTag(newTagName.trim());
    setCreatingTag(false);
    if (id) {
      setForm({ ...form, tagIds: [...form.tagIds, id] });
      setNewTagName('');
    }
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">Nueva persona de aseo</h3>
        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text"
              value={form.contact}
              onChange={e => setForm({ ...form, contact: e.target.value })}
              placeholder="Teléfono / WhatsApp"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Etiquetas (opcional)</label>
            <p className="text-[11px] text-slate-500 mb-2">Filtra por región, confianza u otros criterios. Una persona puede tener varias etiquetas.</p>
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {groups.map(g => {
                  const on = form.tagIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleTag(g.id)}
                      className={`px-2 py-1 text-xs font-semibold rounded-full border transition ${
                        on ? 'text-white' : 'text-slate-600 bg-white hover:bg-slate-50 border-slate-300'
                      }`}
                      style={on ? { backgroundColor: g.color ?? '#475569', borderColor: g.color ?? '#475569' } : undefined}
                    >
                      {on ? '✓ ' : '+ '}{g.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Nueva etiqueta (ej: Villavicencio, Confianza)"
                className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                disabled={creatingTag || !newTagName.trim()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                + Crear
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button
            onClick={onCreate}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TagChip({
  active, onClick, label, color, onDelete,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  onDelete?: () => void;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full text-xs font-semibold border transition ${
      active ? 'text-white' : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
    }`}
      style={active ? { backgroundColor: color ?? '#1e293b', borderColor: color ?? '#1e293b' } : undefined}
    >
      <button type="button" onClick={onClick} className="px-3 py-1">
        {label}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`pr-2 ${active ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-red-600'}`}
          title="Eliminar etiqueta"
          aria-label="Eliminar etiqueta"
        >
          ×
        </button>
      )}
    </span>
  );
}

function NewTagInline({ onCreateTag }: { onCreateTag: (name: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreateTag(name.trim());
    setCreating(false);
    setName('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2 py-1 text-xs font-semibold text-slate-500 border border-dashed border-slate-300 rounded-full hover:border-slate-400 hover:text-slate-700 transition"
      >
        + Nueva etiqueta
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); create(); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="ej: Villavicencio"
        className="px-2 py-1 text-xs border rounded-full w-36 focus:ring-2 focus:ring-blue-400 outline-none"
      />
      <button
        type="button"
        onClick={create}
        disabled={creating || !name.trim()}
        className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 rounded-full hover:bg-blue-700 disabled:opacity-50"
      >
        {creating ? '…' : 'Crear'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
    </div>
  );
}

function DetailModal({
  cleaner, onClose,
}: {
  cleaner: Vendor;
  cleanings: BookingCleaning[]; // legacy prop, ya no se usa (cargamos enriquecido)
  onClose: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [rows, setRows] = useState<CleaningHistoryRow[]>([]);
  const [loose, setLoose] = useState<LooseSupplyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      listCleaningsByCleaner(cleaner.id),
      listCleanerLooseSupplies(cleaner.id),
    ]).then(([res, lRes]) => {
      if (!mounted) return;
      setRows(res.data ?? []);
      setLoose(lRes.data ?? []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cleaner.id]);

  const totalEarned = rows.reduce((s, r) => s + r.fee, 0);
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.fee, 0);
  const totalUnpaid = rows.filter(r => r.status !== 'paid').reduce((s, r) => s + r.fee, 0);
  const totalSuppliesReimb = rows.reduce((s, r) => s + (r.reimburse_to_cleaner ? r.supplies_amount : 0), 0);
  const totalLoosePending = loose.filter(l => l.status === 'pending').reduce((s, l) => s + l.amount, 0);
  const totalLoosePaid = loose.filter(l => l.status === 'paid').reduce((s, l) => s + l.amount, 0);
  const sourceBadge = (s: string | null): string => {
    if (!s) return '—';
    const v = s.toLowerCase();
    if (v.includes('airbnb')) return 'Airbnb';
    if (v.includes('booking')) return 'Booking';
    if (v.includes('direct') || v.includes('directa')) return 'Directa';
    return s;
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-800">🧹 {cleaner.name}</h3>
            <p className="text-sm text-slate-500">Historial de aseos ({rows.length})</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-center text-xs items-start">
            <div className="bg-slate-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-slate-500 font-semibold">Total facturado</div>
              <div className="text-base font-bold text-slate-800">{formatCurrency(totalEarned)}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-emerald-600 font-semibold">Pagado</div>
              <div className="text-base font-bold text-emerald-700">{formatCurrency(totalPaid)}</div>
            </div>
            <div className="bg-amber-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-amber-600 font-semibold">Sin pagar</div>
              <div className="text-base font-bold text-amber-700">{formatCurrency(totalUnpaid)}</div>
            </div>
            <div className="bg-indigo-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center">
              <div className="text-[10px] uppercase text-indigo-600 font-semibold">Insumos reemb.</div>
              <div className="text-base font-bold text-indigo-700">{formatCurrency(totalSuppliesReimb)}</div>
            </div>
            <div className="bg-cyan-50 rounded-lg px-3 py-2 min-h-[72px] flex flex-col justify-center" title="Insumos comprados por la persona, sin asignar a una reserva">
              <div className="text-[10px] uppercase text-cyan-600 font-semibold">Insumos sueltos</div>
              <div className="text-base font-bold text-cyan-700">{formatCurrency(totalLoosePending)}</div>
              <div className="text-[10px] text-cyan-600">pend · pagado: {formatCurrency(totalLoosePaid)}</div>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-8">Cargando historial…</p>
          ) : (
            <>
              {/* Sección 1: aseos por reserva */}
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  🧹 Aseos hechos por reserva
                  <span className="text-[10px] text-slate-400 font-normal">({rows.length})</span>
                </h4>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 bg-slate-50 rounded-lg text-center">Aún no hay aseos registrados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                        <tr>
                          <th className="text-left py-2 px-2">Estado</th>
                          <th className="text-left py-2 px-2">Propiedad</th>
                          <th className="text-left py-2 px-2">Reserva</th>
                          <th className="text-left py-2 px-2">Huésped</th>
                          <th className="text-left py-2 px-2">Fecha aseo</th>
                          <th className="text-left py-2 px-2">Pagado</th>
                          <th className="text-right py-2 px-2">Tarifa</th>
                          <th className="text-right py-2 px-2">Insumos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(r => (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="py-2 px-2">
                              {r.status === 'paid' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Pagado</span>}
                              {r.status === 'done' && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Hecho</span>}
                              {r.status === 'pending' && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Pendiente</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-700 font-medium">{r.property_name ?? '—'}</td>
                            <td className="py-2 px-2">
                              {r.booking_id ? (
                                <a
                                  href={`/bookings?focus=${r.booking_id}`}
                                  className="text-blue-600 hover:underline text-xs font-mono"
                                  title="Abrir reserva"
                                >
                                  {r.booking_code ?? r.booking_id.slice(0, 8)}
                                </a>
                              ) : '—'}
                              {r.listing_source && (
                                <span className="ml-1.5 text-[10px] text-slate-400">· {sourceBadge(r.listing_source)}</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-slate-600 truncate max-w-[180px]" title={r.guest_name ?? undefined}>
                              {r.guest_name ?? '—'}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{r.done_date ?? r.check_out ?? '—'}</td>
                            <td className="py-2 px-2 text-slate-500">{r.paid_date ?? '—'}</td>
                            <td className="py-2 px-2 text-right font-semibold">{formatCurrency(r.fee)}</td>
                            <td className="py-2 px-2 text-right">
                              {r.supplies_amount > 0 ? (
                                <span
                                  className={r.reimburse_to_cleaner ? 'text-indigo-700 font-semibold' : 'text-slate-400'}
                                  title={r.reimburse_to_cleaner ? 'Insumos reembolsados al cleaner en la liquidación' : 'Insumos NO reembolsados al cleaner'}
                                >
                                  {formatCurrency(r.supplies_amount)}
                                  {!r.reimburse_to_cleaner && <span className="ml-1 text-[10px]">(no reemb.)</span>}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Sección 2: insumos sueltos comprados por la persona */}
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  🧴 Insumos comprados por la persona
                  <span className="text-[10px] text-slate-400 font-normal">({loose.length})</span>
                  {totalLoosePending > 0 && (
                    <span className="ml-auto text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                      Por liquidar: {formatCurrency(totalLoosePending)}
                    </span>
                  )}
                </h4>
                {loose.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3 bg-slate-50 rounded-lg text-center">
                    No hay compras de insumos registradas a nombre de esta persona.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                        <tr>
                          <th className="text-left py-2 px-2">Estado</th>
                          <th className="text-left py-2 px-2">Fecha</th>
                          <th className="text-left py-2 px-2">Propiedad</th>
                          <th className="text-left py-2 px-2">Detalle</th>
                          <th className="text-left py-2 px-2">Pagado</th>
                          <th className="text-right py-2 px-2">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loose.map(l => (
                          <tr key={l.id} className="hover:bg-slate-50">
                            <td className="py-2 px-2">
                              {l.status === 'paid'
                                ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Liquidado</span>
                                : <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Por liquidar</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{l.date}</td>
                            <td className="py-2 px-2 text-slate-700">{l.property_name ?? <span className="text-slate-400">—</span>}</td>
                            <td className="py-2 px-2 text-slate-600 truncate max-w-[260px]" title={l.description ?? undefined}>
                              {l.description ?? <span className="text-slate-400">Sin detalle</span>}
                            </td>
                            <td className="py-2 px-2 text-slate-500">{l.paid_date ?? '—'}</td>
                            <td className="py-2 px-2 text-right font-semibold text-cyan-700">{formatCurrency(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PayoutModal({
  cleaner, balance, looseAmount, looseCount, banks, onClose, onConfirm,
}: {
  cleaner: Vendor;
  balance: ReturnType<typeof computeCleanerBalances> extends Map<string, infer V> ? V | undefined : never;
  looseAmount: number;
  looseCount: number;
  banks: BankAccountRow[];
  onClose: () => void;
  onConfirm: (args: { paidDate: string; bankAccountId: string | null; includePending: boolean }) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [paidDate, setPaidDate] = useState(todayISO());
  const [bankId, setBankId] = useState<string>('');
  const [includePending, setIncludePending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaningAmount = (balance?.done_unpaid_amount ?? 0) + (includePending ? (balance?.pending_amount ?? 0) : 0);
  const cleaningCount = (balance?.done_unpaid_count ?? 0) + (includePending ? (balance?.pending_count ?? 0) : 0);
  const amount = cleaningAmount + looseAmount;
  const count = cleaningCount;

  const submit = async () => {
    setWorking(true);
    setError(null);
    const err = await onConfirm({ paidDate, bankAccountId: bankId || null, includePending });
    setWorking(false);
    if (err) setError(err);
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="p-6 border-b">
          <h3 className="text-xl font-bold text-slate-800">💸 Liquidar a {cleaner.name}</h3>
          <p className="text-xs text-slate-500 mt-1">Crea un gasto por reserva (aseo + insumos por separado) y los marca como pagados.</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-xs text-emerald-700 font-semibold uppercase tracking-wide">A pagar ahora</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(amount)}</div>
            <div className="text-xs text-emerald-700/80 mt-1 space-y-0.5">
              <div>🧹 Aseos: {formatCurrency(cleaningAmount)} ({count} aseo{count === 1 ? '' : 's'})</div>
              {looseCount > 0 && (
                <div>🧴 Insumos sueltos: {formatCurrency(looseAmount)} ({looseCount} compra{looseCount === 1 ? '' : 's'})</div>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includePending}
              onChange={e => setIncludePending(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Incluir aseos <strong>pendientes</strong> ({balance?.pending_count ?? 0} · {formatCurrency(balance?.pending_amount ?? 0)})
              <div className="text-xs text-slate-500">Normalmente solo se paga lo ya hecho. Actívalo si vas a pagar por adelantado.</div>
            </span>
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de pago</label>
            <input
              type="date"
              value={paidDate}
              onChange={e => setPaidDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta bancaria (opcional)</label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">— Sin especificar —</option>
              {banks.map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.bank ? ` · ${b.bank}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
            Por cada aseo se creará un gasto independiente <strong>"Aseo – {'{propiedad}'} · Reserva {'{código}'}"</strong>{' '}
            con categoría <code className="bg-white px-1 rounded">cleaning</code> y status{' '}
            <code className="bg-white px-1 rounded">paid</code>. Si el aseo tenía insumos reembolsables se generará{' '}
            <strong>otro gasto separado</strong> <em>"Insumos de aseo – {'{propiedad}'} · Reserva {'{código}'}"</em>.
            {looseCount > 0 && (
              <> Las <strong>{looseCount} compras de insumos sueltas</strong> ya registradas a nombre de esta persona se marcarán como pagadas y se unirán al mismo grupo de liquidación.</>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={working || amount === 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {working ? 'Procesando…' : `Pagar ${formatCurrency(amount)}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Edit & Delete cleaner modals (Bloque 15A)
// ─────────────────────────────────────────────────────────────────
function EditCleanerModal({
  cleaner, initialTagIds, groups, onClose, onSave,
}: {
  cleaner: Vendor;
  initialTagIds: string[];
  groups: CleanerGroup[];
  onClose: () => void;
  onSave: (patch: { name: string; contact: string; active: boolean; tagIds: string[] }) => Promise<string | null>;
}) {
  const [name, setName] = useState(cleaner.name);
  const [contact, setContact] = useState(cleaner.contact ?? '');
  const [active, setActive] = useState(cleaner.active);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const backdrop = useBackdropClose(onClose);

  const toggle = (id: string) =>
    setTagIds(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]);

  const submit = async () => {
    if (!name.trim()) { setErr('El nombre es obligatorio'); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ name, contact, active, tagIds });
    setSaving(false);
    if (e) setErr(e);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">Editar {cleaner.name}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text" value={contact} onChange={e => setContact(e.target.value)}
              placeholder="Teléfono / WhatsApp"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Etiquetas</label>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => {
                const on = tagIds.includes(g.id);
                return (
                  <button
                    type="button" key={g.id} onClick={() => toggle(g.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                      on ? 'text-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                    }`}
                    style={on ? { backgroundColor: g.color ?? '#475569', borderColor: g.color ?? '#475569' } : undefined}
                  >
                    {on ? '✓ ' : ''}{g.name}
                  </button>
                );
              })}
              {groups.length === 0 && <span className="text-xs text-slate-400">Sin etiquetas creadas todavía.</span>}
            </div>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="text-xs text-slate-700">Activo (desmarca para desactivar sin borrar historial)</span>
          </label>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:bg-slate-300">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ConfirmDeleteModal({
  cleaner, hasCleanings, onClose, onConfirm,
}: {
  cleaner: Vendor;
  hasCleanings: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const backdrop = useBackdropClose(onClose);
  const submit = async () => {
    setWorking(true); setErr(null);
    const e = await onConfirm();
    setWorking(false);
    if (e) setErr(e);
  };
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-2">Eliminar a {cleaner.name}</h3>
        {hasCleanings ? (
          <p className="text-sm text-slate-600 mb-4">
            Esta persona tiene aseos registrados y no se puede borrar para preservar el historial.
            En su lugar la <strong>desactivaremos</strong>: dejará de aparecer en los formularios pero
            su historial se mantiene intacto. Puedes reactivarla desde "Editar".
          </p>
        ) : (
          <p className="text-sm text-slate-600 mb-4">
            Esta persona no tiene aseos registrados. Se eliminará permanentemente.
          </p>
        )}
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button onClick={submit} disabled={working}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:bg-slate-300">
            {working ? 'Procesando…' : (hasCleanings ? 'Desactivar' : 'Eliminar')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
