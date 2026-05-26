/**
 * CreditPoolsClient.tsx
 *
 * UI dedicada para gestionar "bolsas de créditos" (típicamente seguros de
 * responsabilidad civil que se compran como paquetes prepagados).
 *
 * Una bolsa tiene:
 *   - Cantidad total de créditos y precio total.
 *   - Regla de consumo: per_person_per_night | per_person_per_booking | per_booking
 *   - Créditos por unidad (cuántos créditos cuesta cada unidad de la regla).
 *   - Peso de niños (multiplicador 0..1 para reglas "per_person_*").
 *   - Fecha de activación: antes de esta fecha NO descuenta nada.
 *
 * El consumo ocurre automáticamente al hacer check-in (manual o nocturno).
 * Esta página solo administra las bolsas; no consume nada por sí misma.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { toast } from '@/lib/toast';
import { listVendors, type Vendor } from '@/services/vendors';
import { listProperties } from '@/services/properties';
import {
  listCreditPools, createCreditPool, updateCreditPool, archiveCreditPool,
  listConsumptionsForPool, resolvePoolProperties, setCreditPoolProperties,
  unitPriceOf, calcUnitsForBooking,
  deleteCreditPoolConsumptions, recomputeCreditPoolSnapshots, hardDeleteCreditPool,
} from '@/services/creditPools';
import type {
  CreditPoolRow, CreditPoolConsumptionRow, CreditPoolConsumptionRule,
  PropertyRow,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import MoneyInput from '@/components/MoneyInput';
import { useBackdropClose, makeBackdropHandlers } from '@/lib/useBackdropClose';
import { todayISO } from '@/lib/dateUtils';

const RULE_LABELS: Record<CreditPoolConsumptionRule, string> = {
  per_person_per_night:  'Por persona y noche',
  per_person_per_booking: 'Por persona (toda la reserva)',
  per_booking:            'Por reserva (fijo)',
};

interface Form {
  name: string;
  vendor_id: string;
  credits_total: string;
  total_price: string;
  consumption_rule: CreditPoolConsumptionRule;
  credits_per_unit: string;
  child_weight: string;
  activated_at: string;
  expires_at: string;
  notes: string;
}

const EMPTY: Form = {
  name: '',
  vendor_id: '',
  credits_total: '',
  total_price: '',
  consumption_rule: 'per_person_per_night',
  credits_per_unit: '1',
  child_weight: '1',
  activated_at: todayISO(),
  expires_at: '',
  notes: '',
};

export default function CreditPoolsClient() {
  const authStatus = useAuth();
  const [pools, setPools] = useState<CreditPoolRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propsByPool, setPropsByPool] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CreditPoolRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CreditPoolRow | null>(null);
  const [calcTarget, setCalcTarget] = useState<CreditPoolRow | null>(null);
  const [propsTarget, setPropsTarget] = useState<CreditPoolRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, vRes, prRes] = await Promise.all([
      listCreditPools(),
      listVendors(),
      listProperties(),
    ]);
    if (pRes.data) setPools(pRes.data);
    if (vRes.data) setVendors(vRes.data);
    if (prRes.data) setProperties(prRes.data);

    // Cargar cobertura por bolsa (en paralelo).
    if (pRes.data) {
      const entries = await Promise.all(
        pRes.data.map(async (p) => [p.id, await resolvePoolProperties(p)] as const),
      );
      setPropsByPool(new Map(entries));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredPools = useMemo(() => {
    if (filter === 'all') return pools;
    if (filter === 'archived') return pools.filter(p => p.status === 'archived');
    return pools.filter(p => p.status !== 'archived');
  }, [pools, filter]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, activated_at: todayISO() });
    setErr(null);
    setModalOpen(true);
  };

  const openEdit = (p: CreditPoolRow) => {
    setEditing(p);
    setForm({
      name: p.name,
      vendor_id: p.vendor_id ?? '',
      credits_total: String(p.credits_total),
      total_price: String(p.total_price),
      consumption_rule: p.consumption_rule,
      credits_per_unit: String(p.credits_per_unit),
      child_weight: String(p.child_weight),
      activated_at: p.activated_at,
      expires_at: p.expires_at ?? '',
      notes: p.notes ?? '',
    });
    setErr(null);
    setModalOpen(true);
  };

  const submit = useCallback(async () => {
    setErr(null);
    if (!form.name.trim()) { setErr('El nombre es obligatorio.'); return; }
    const credits = Number(form.credits_total);
    if (!Number.isFinite(credits) || credits <= 0) { setErr('Créditos totales debe ser mayor a 0.'); return; }
    const price = Number(form.total_price);
    if (!Number.isFinite(price) || price <= 0) { setErr('El precio total es obligatorio — sin él no se puede calcular el costo por crédito.'); return; }
    const cpu = Number(form.credits_per_unit);
    if (!Number.isFinite(cpu) || cpu <= 0) { setErr('Créditos por unidad debe ser mayor a 0.'); return; }
    const cw = Number(form.child_weight);
    if (!Number.isFinite(cw) || cw < 0) { setErr('Peso de niños debe ser ≥ 0.'); return; }
    if (!form.activated_at) { setErr('Fecha de activación obligatoria.'); return; }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      vendor_id: form.vendor_id || null,
      credits_total: credits,
      total_price: price,
      consumption_rule: form.consumption_rule,
      credits_per_unit: cpu,
      child_weight: cw,
      activated_at: form.activated_at,
      expires_at: form.expires_at || null,
      notes: form.notes.trim() || null,
    };
    const res = editing
      ? await updateCreditPool(editing.id, payload)
      : await createCreditPool(payload);
    setSaving(false);
    if (res.error) { setErr(res.error); toast.error(res.error); return; }
    toast.success(editing ? 'Bolsa actualizada' : 'Bolsa creada');
    setModalOpen(false);
    await load();
  }, [form, editing, load]);

  const onArchive = useCallback(async (p: CreditPoolRow) => {
    if (!confirm(`¿Archivar la bolsa "${p.name}"? No descontará más créditos de futuras reservas.`)) return;
    const res = await archiveCreditPool(p.id);
    if (res?.error) { toast.error(res.error); return; }
    toast.success(`Bolsa "${p.name}" archivada`);
    await load();
  }, [load]);

  const onDeleteConsumptions = useCallback(async (p: CreditPoolRow) => {
    const ok = confirm(
      `¿Borrar TODOS los consumos de la bolsa "${p.name}"?\n\n` +
      `Esto eliminará el desglose de atribución por propiedad y reseteará los ` +
      `créditos usados a 0. El gasto original de la compra de la bolsa NO se toca.\n\n` +
      `Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    const res = await deleteCreditPoolConsumptions(p.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`Se borraron ${res.data?.deleted ?? 0} consumos de "${p.name}"`);
    await load();
  }, [load]);

  const onRecomputeSnapshots = useCallback(async (p: CreditPoolRow) => {
    const ok = confirm(
      `¿Recalcular los precios históricos de los consumos de "${p.name}" ` +
      `usando el precio/crédito ACTUAL de la bolsa?\n\n` +
      `Úsalo sólo si la bolsa quedó mal configurada al momento del consumo ` +
      `(p.ej. quedaron en $0).`
    );
    if (!ok) return;
    const res = await recomputeCreditPoolSnapshots(p.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success(
      `Recalculados ${res.data?.updated ?? 0} consumos a ${formatCurrency(res.data?.unitPrice ?? 0)}/crédito`
    );
    await load();
  }, [load]);

  const onHardDelete = useCallback(async (p: CreditPoolRow) => {
    if (!confirm(`¿Eliminar DEFINITIVAMENTE la bolsa "${p.name}"?\n\nEsta acción no se puede deshacer.`)) return;
    const res = await hardDeleteCreditPool(p.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`Bolsa "${p.name}" eliminada`);
    await load();
  }, [load]);

  useBackdropClose(() => setModalOpen(false));
  useBackdropClose(() => setHistoryTarget(null));

  if (authStatus !== 'authed') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center text-amber-800">
        Inicia sesión para administrar bolsas de créditos.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 flex items-center gap-2">
            <span>🪙</span> Bolsas de créditos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Seguros, pólizas o servicios prepagados que se descuentan automáticamente
            al hacer check-in de una reserva (sólo aplica a reservas con check-in
            posterior a la fecha de activación de la bolsa).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as 'all' | 'active' | 'archived')}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="active">Vigentes</option>
            <option value="archived">Archivadas</option>
            <option value="all">Todas</option>
          </select>
          <button
            onClick={openNew}
            className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 shadow-sm"
          >
            <span className="text-base leading-none">+</span> Nueva bolsa
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Cargando…</p>
      ) : filteredPools.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <p className="text-3xl mb-2">🪙</p>
          <p className="text-slate-700 font-semibold">Aún no tienes bolsas de créditos.</p>
          <p className="text-sm text-slate-500 mt-1">
            Crea una para que los créditos se descuenten automáticamente al hacer check-in.
          </p>
        </div>
      ) : (
        <PoolsGrouped
          pools={filteredPools}
          vendors={vendors}
          properties={properties}
          propsByPool={propsByPool}
          onEdit={openEdit}
          onArchive={onArchive}
          onHistory={(p) => setHistoryTarget(p)}
          onCalc={(p) => setCalcTarget(p)}
          onEditProps={(p) => setPropsTarget(p)}
          onDeleteConsumptions={onDeleteConsumptions}
          onRecomputeSnapshots={onRecomputeSnapshots}
          onHardDelete={onHardDelete}
        />
      )}

      {/* MODAL CREAR/EDITAR */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            {...makeBackdropHandlers(() => setModalOpen(false))}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseUp={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-slate-800 mb-3">
                {editing ? 'Editar bolsa de créditos' : 'Nueva bolsa de créditos'}
              </h3>

              {editing && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  ℹ️ Editar esta bolsa <b>no afecta los gastos ya registrados ni las
                  reservas que ya descontaron créditos</b>. Los cambios solo aplican
                  a futuras reservas con check-in pendiente.
                </p>
              )}

              {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
                  <input
                    type="text" value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej. Seguro RC Q2 2026"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Proveedor (opcional)</label>
                  <select
                    value={form.vendor_id}
                    onChange={e => setForm({ ...form, vendor_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    <option value="">— Sin proveedor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name} · {v.kind}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Créditos totales *</label>
                    <input
                      type="number" min="1" value={form.credits_total}
                      onChange={e => setForm({ ...form, credits_total: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Precio total (COP)</label>
                    <MoneyInput
                      value={Number(form.total_price) || null}
                      onChange={v => setForm({ ...form, total_price: v == null ? '' : String(v) })}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Regla de consumo *</label>
                  <select
                    value={form.consumption_rule}
                    onChange={e => setForm({ ...form, consumption_rule: e.target.value as CreditPoolConsumptionRule })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    <option value="per_person_per_night">Por persona y noche</option>
                    <option value="per_person_per_booking">Por persona (toda la reserva)</option>
                    <option value="per_booking">Por reserva (fijo)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Créditos por unidad *
                    </label>
                    <input
                      type="number" min="0.01" step="0.01" value={form.credits_per_unit}
                      onChange={e => setForm({ ...form, credits_per_unit: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Cuántos créditos cuesta cada unidad de la regla.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Peso niños (0–1+)
                    </label>
                    <input
                      type="number" min="0" step="0.1" value={form.child_weight}
                      onChange={e => setForm({ ...form, child_weight: e.target.value })}
                      disabled={form.consumption_rule === 'per_booking'}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none disabled:bg-slate-100"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      1 = igual que adulto · 0 = no cuentan.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Activación *</label>
                    <input
                      type="date" value={form.activated_at}
                      onChange={e => setForm({ ...form, activated_at: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Solo descuenta sobre reservas con check-in ≥ esta fecha.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Expira (opcional)</label>
                    <input
                      type="date" value={form.expires_at}
                      onChange={e => setForm({ ...form, expires_at: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
                  <textarea
                    rows={2} value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                  Cancelar
                </button>
                <button onClick={submit} disabled={saving}
                  className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-60">
                  {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL HISTORIAL */}
      <AnimatePresence>
        {historyTarget && (
          <PoolHistoryModal
            pool={historyTarget}
            onClose={() => setHistoryTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* MODAL CALCULADORA */}
      <AnimatePresence>
        {calcTarget && (
          <PoolCalcModal
            pool={calcTarget}
            onClose={() => setCalcTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* MODAL EDITAR PROPIEDADES (sólo bolsas sin vendor) */}
      <AnimatePresence>
        {propsTarget && (
          <PoolPropertiesModal
            pool={propsTarget}
            properties={properties}
            currentIds={propsByPool.get(propsTarget.id) ?? []}
            onClose={() => setPropsTarget(null)}
            onSaved={async () => { setPropsTarget(null); await load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Modal historial ──────────────────────────────────────────────────────────

function PoolHistoryModal({ pool, onClose }: {
  pool: CreditPoolRow;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CreditPoolConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listConsumptionsForPool(pool.id).then(res => {
      if (res.data) setRows(res.data);
      setLoading(false);
    });
  }, [pool.id]);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-1">📜 Historial: {pool.name}</h3>
        <p className="text-xs text-slate-500 mb-4">
          {Number(pool.credits_used).toLocaleString('es-CO')} de {Number(pool.credits_total).toLocaleString('es-CO')} créditos consumidos
        </p>
        {loading ? <p className="text-sm text-slate-500">Cargando…</p>
          : rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              Aún no hay consumos registrados.
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {rows.map(r => (
                <div key={r.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-semibold text-slate-700">
                      {Number(r.credits_used).toLocaleString('es-CO')} créditos
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.units} unidades · {r.occurred_at}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </p>
                  </div>
                  <a
                    href={`/bookings#${r.booking_id}`}
                    className="text-xs text-amber-700 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver reserva ↗
                  </a>
                </div>
              ))}
            </div>
          )}
        <div className="mt-5 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cerrar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Grid agrupado por vendor ────────────────────────────────────────────────

function PoolsGrouped({
  pools, vendors, properties, propsByPool,
  onEdit, onArchive, onHistory, onCalc, onEditProps,
  onDeleteConsumptions, onRecomputeSnapshots, onHardDelete,
}: {
  pools: CreditPoolRow[];
  vendors: Vendor[];
  properties: PropertyRow[];
  propsByPool: Map<string, string[]>;
  onEdit: (p: CreditPoolRow) => void;
  onArchive: (p: CreditPoolRow) => void;
  onHistory: (p: CreditPoolRow) => void;
  onCalc: (p: CreditPoolRow) => void;
  onEditProps: (p: CreditPoolRow) => void;
  onDeleteConsumptions: (p: CreditPoolRow) => void;
  onRecomputeSnapshots: (p: CreditPoolRow) => void;
  onHardDelete: (p: CreditPoolRow) => void;
}) {
  // Agrupa por vendor_id (null = "Sin proveedor"); ordena bolsas por
  // activated_at asc (FIFO: la más antigua primero, la próxima a consumirse).
  const groups = useMemo(() => {
    const byVendor = new Map<string, CreditPoolRow[]>();
    for (const p of pools) {
      const key = p.vendor_id ?? '__none__';
      const arr = byVendor.get(key);
      if (arr) arr.push(p); else byVendor.set(key, [p]);
    }
    for (const arr of byVendor.values()) {
      arr.sort((a, b) => a.activated_at.localeCompare(b.activated_at));
    }
    return [...byVendor.entries()];
  }, [pools]);

  const propsById = useMemo(
    () => new Map(properties.map(p => [p.id, p.name] as const)),
    [properties],
  );

  return (
    <div className="space-y-6">
      {groups.map(([vendorKey, vendorPools]) => {
        const vendor = vendorKey === '__none__' ? null : vendors.find(v => v.id === vendorKey);
        const totalCredits = vendorPools.reduce((s, p) => s + Number(p.credits_total), 0);
        const usedCredits = vendorPools.reduce((s, p) => s + Number(p.credits_used), 0);
        const totalCop = vendorPools.reduce((s, p) => s + Number(p.total_price), 0);
        return (
          <section key={vendorKey} className="bg-slate-50/60 border border-slate-200 rounded-2xl p-3 sm:p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2 mb-3 px-1">
              <h2 className="text-sm font-bold text-slate-800">
                {vendor ? <>🏢 {vendor.name}</> : <>🪙 Bolsas sin proveedor</>}
                <span className="text-xs font-normal text-slate-500 ml-2">
                  {vendorPools.length} bolsa{vendorPools.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <div className="text-xs text-slate-600">
                <b>{usedCredits.toLocaleString('es-CO')}</b>/{totalCredits.toLocaleString('es-CO')} créditos · {formatCurrency(totalCop)} invertido
              </div>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {vendorPools.map((p, idx) => (
                <PoolCard
                  key={p.id}
                  pool={p}
                  fifoOrder={idx + 1}
                  fifoTotal={vendorPools.filter(x => x.status === 'active').length}
                  propertyIds={propsByPool.get(p.id) ?? []}
                  propertyNames={propsById}
                  inheritedFromVendor={!!p.vendor_id}
                  onEdit={() => onEdit(p)}
                  onArchive={() => onArchive(p)}
                  onHistory={() => onHistory(p)}
                  onCalc={() => onCalc(p)}
                  onEditProps={() => onEditProps(p)}
                  onDeleteConsumptions={() => onDeleteConsumptions(p)}
                  onRecomputeSnapshots={() => onRecomputeSnapshots(p)}
                  onHardDelete={() => onHardDelete(p)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PoolCard({
  pool: p, fifoOrder, fifoTotal, propertyIds, propertyNames,
  inheritedFromVendor,
  onEdit, onArchive, onHistory, onCalc, onEditProps,
  onDeleteConsumptions, onRecomputeSnapshots, onHardDelete,
}: {
  pool: CreditPoolRow;
  fifoOrder: number;
  fifoTotal: number;
  propertyIds: string[];
  propertyNames: Map<string, string>;
  inheritedFromVendor: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onHistory: () => void;
  onCalc: () => void;
  onEditProps: () => void;
  onDeleteConsumptions: () => void;
  onRecomputeSnapshots: () => void;
  onHardDelete: () => void;
}) {
  const remaining = Number(p.credits_total) - Number(p.credits_used);
  const pct = Number(p.credits_total) > 0
    ? Math.min(100, Math.round((Number(p.credits_used) / Number(p.credits_total)) * 100))
    : 0;
  const unitPrice = unitPriceOf(p);

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm ${
      p.status === 'archived' ? 'border-slate-200 opacity-70' :
      p.status === 'depleted' ? 'border-red-300' : 'border-amber-200'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-800 truncate">{p.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {p.status === 'active' && fifoTotal > 1 && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-700"
                title="Orden FIFO: las bolsas más antiguas se consumen primero">
                FIFO #{fifoOrder}
              </span>
            )}
            <span className="text-[10px] text-slate-500">{p.activated_at}</span>
          </div>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          p.status === 'active'    ? 'bg-emerald-100 text-emerald-700' :
          p.status === 'depleted'  ? 'bg-red-100 text-red-700' :
          'bg-slate-100 text-slate-500'
        }`}>
          {p.status === 'active' ? 'Activa' : p.status === 'depleted' ? 'Agotada' : 'Archivada'}
        </span>
      </div>

      {/* barra de progreso */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          <span>{Number(p.credits_used).toLocaleString('es-CO')} usados</span>
          <span><b>{remaining.toLocaleString('es-CO')}</b> restantes</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-1 text-xs text-slate-600">
        <p>📐 {RULE_LABELS[p.consumption_rule]} · {Number(p.credits_per_unit)} créd/unidad{p.consumption_rule !== 'per_booking' ? ` · niños ×${Number(p.child_weight)}` : ''}</p>
        <p>💰 {formatCurrency(Number(p.total_price))} total · <b className="text-amber-700">{formatCurrency(unitPrice)} / crédito</b></p>
        {p.expires_at && <p>⏳ Expira {p.expires_at}</p>}
        {/* Advertencia: bolsa incompleta — no puede consumirse */}
        {(Number(p.total_price) <= 0 || Number(p.credits_per_unit) <= 0) && (
          <p className="mt-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            ⚠️ Bolsa incompleta — falta el precio o créditos/unidad. No descontará créditos hasta que se complete.
          </p>
        )}
      </div>

      {/* Propiedades cubiertas */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Propiedades cubiertas
            {inheritedFromVendor && (
              <span className="ml-1.5 text-slate-400 normal-case font-normal" title="Heredadas del proveedor">
                (del proveedor)
              </span>
            )}
          </p>
          {!inheritedFromVendor && (
            <button onClick={onEditProps} className="text-[10px] text-amber-700 hover:underline font-semibold">
              Editar
            </button>
          )}
        </div>
        {propertyIds.length === 0 ? (
          <p className="text-[11px] italic text-rose-600">
            {inheritedFromVendor
              ? 'El proveedor no tiene propiedades asignadas — esta bolsa no consumirá créditos.'
              : 'Sin propiedades — agrega al menos una para que se descuenten créditos.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {propertyIds.slice(0, 6).map(pid => (
              <span key={pid} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                {propertyNames.get(pid) ?? pid.slice(0, 8)}
              </span>
            ))}
            {propertyIds.length > 6 && (
              <span className="text-[10px] text-slate-500">+{propertyIds.length - 6} más</span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
        <button onClick={onCalc} className="flex-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 py-1.5 rounded">
          Calcular
        </button>
        <button onClick={onHistory} className="flex-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 py-1.5 rounded">
          Historial
        </button>
        <button onClick={onEdit} className="flex-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 py-1.5 rounded">
          Editar
        </button>
        {p.status !== 'archived' && (
          <button onClick={onArchive} className="flex-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 py-1.5 rounded">
            Archivar
          </button>
        )}
        <button onClick={onHardDelete} className="flex-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 py-1.5 rounded">
          Eliminar
        </button>
      </div>

      {/* Acciones de mantenimiento — sólo cuando hay consumos asociados */}
      {Number(p.credits_used) > 0 && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onRecomputeSnapshots}
            className="flex-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 py-1.5 rounded border border-sky-100"
            title="Recalcula los precios congelados de los consumos usando el precio/crédito actual de la bolsa."
          >
            Recalcular precios
          </button>
          <button
            onClick={onDeleteConsumptions}
            className="flex-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 py-1.5 rounded border border-rose-100"
            title="Borra todos los consumos de esta bolsa (limpia el panel de atribución). No afecta el gasto de compra."
          >
            Borrar consumos
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Modal calculadora ────────────────────────────────────────────────────────

function PoolCalcModal({ pool, onClose }: { pool: CreditPoolRow; onClose: () => void }) {
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [nights, setNights] = useState('3');
  const unitPrice = unitPriceOf(pool);
  const units = calcUnitsForBooking(
    { num_adults: Number(adults) || 0, num_children: Number(children) || 0, num_nights: Number(nights) || 1 },
    pool.consumption_rule,
    Number(pool.child_weight),
  );
  const credits = units * Number(pool.credits_per_unit);
  const cost = credits * unitPrice;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-1">🧮 Calculadora</h3>
        <p className="text-xs text-slate-500 mb-4">
          <b>{pool.name}</b> · {RULE_LABELS[pool.consumption_rule]}
        </p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Adultos</label>
            <input type="number" min={0} value={adults} onChange={e => setAdults(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Niños</label>
            <input type="number" min={0} value={children} onChange={e => setChildren(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Noches</label>
            <input type="number" min={1} value={nights} onChange={e => setNights(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none" />
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-600">Unidades:</span><b>{units.toFixed(2)}</b></div>
          <div className="flex justify-between"><span className="text-slate-600">Créditos:</span><b>{credits.toFixed(2)}</b></div>
          <div className="flex justify-between"><span className="text-slate-600">Precio/crédito:</span><b>{formatCurrency(unitPrice)}</b></div>
          <div className="flex justify-between text-base pt-1 border-t border-amber-200 mt-1">
            <span className="text-slate-700 font-semibold">Costo:</span>
            <b className="text-amber-700">{formatCurrency(cost)}</b>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cerrar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Modal propiedades (sólo bolsas sin vendor) ───────────────────────────────

function PoolPropertiesModal({
  pool, properties, currentIds, onClose, onSaved,
}: {
  pool: CreditPoolRow;
  properties: PropertyRow[];
  currentIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const inheritedFromVendor = !!pool.vendor_id;
  const [selected, setSelected] = useState<Set<string>>(new Set(currentIds));
  const [saving, setSaving] = useState(false);
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const save = async () => {
    setSaving(true);
    const res = await setCreditPoolProperties(pool.id, [...selected]);
    setSaving(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Propiedades actualizadas');
    onSaved();
  };
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-1">Propiedades cubiertas</h3>
        <p className="text-xs text-slate-500 mb-3">
          Sólo las reservas de estas propiedades consumirán créditos de <b>{pool.name}</b>.
        </p>
        {inheritedFromVendor ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Esta bolsa hereda cobertura del proveedor. Para cambiar las propiedades,
            edita el proveedor en la pestaña de Proveedores.
          </p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto border border-slate-200 rounded-lg p-2">
            {properties.map(prop => (
              <label key={prop.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(prop.id)}
                  onChange={() => toggle(prop.id)}
                  className="w-4 h-4 accent-amber-600"
                />
                <span className="text-sm text-slate-700">{prop.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-5 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cerrar
          </button>
          {!inheritedFromVendor && (
            <button onClick={save} disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-60">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
