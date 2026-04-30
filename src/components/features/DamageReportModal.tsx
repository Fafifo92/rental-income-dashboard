'use client';
/**
 * Modal canónico para registrar un daño.
 *
 * Reglas:
 *  - Todo daño está atado a una RESERVA (no se permite daño huérfano).
 *  - El "sujeto" del daño es:
 *      a) un item del INVENTARIO de la propiedad de esa reserva, o
 *      b) algo de la PROPIEDAD que no está en inventario (pared, estufa empotrada, piso…)
 *         — texto libre.
 *  - Al guardar se invoca `reportDamage` que:
 *      · Crea un expense pendiente "Reparación …" (categoría según sujeto).
 *      · (Opcional) crea un booking_adjustment damage_charge con el cobro al huésped/plataforma.
 *      · Si el sujeto es un item de inventario, marca el item como `damaged`
 *        y registra un inventory_movement.
 *      · Aplica idempotencia: si ya hay un daño pendiente para el mismo
 *        (booking, sujeto), no duplica.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { reportDamage } from '@/services/inventory';
import { listInventoryItems } from '@/services/inventory';
import type { BookingRow, InventoryItemRow } from '@/types/database';
import { useBackdropClose } from '@/lib/useBackdropClose';
import MoneyInput from '@/components/MoneyInput';

const STRUCTURAL_SUGGESTIONS = [
  'Pared', 'Piso', 'Techo', 'Puerta', 'Ventana', 'Cerradura',
  'Estufa empotrada', 'Horno', 'Lavaplatos', 'Inodoro', 'Lavamanos',
  'Ducha / grifería', 'Mesón cocina', 'Cableado eléctrico', 'Otro',
];

export interface DamageReportModalProps {
  /** Propiedad sobre la que se registra el daño. */
  propertyId: string;
  propertyName?: string;
  /** Reserva a la que queda atado el daño (obligatoria). */
  booking: Pick<BookingRow, 'id' | 'confirmation_code' | 'guest_name' | 'start_date' | 'end_date'>;
  /** Item de inventario pre-seleccionado (cuando se entra desde InventoryClient). */
  presetItem?: InventoryItemRow | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function DamageReportModal({
  propertyId, propertyName, booking, presetItem = null, onClose, onSaved,
}: DamageReportModalProps): JSX.Element {
  const backdrop = useBackdropClose(onClose);
  const [mode, setMode] = useState<'inventory' | 'structural'>(presetItem ? 'inventory' : 'inventory');
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [itemId, setItemId] = useState<string>(presetItem?.id ?? '');
  const [structuralLabel, setStructuralLabel] = useState<string>('');
  const [structuralCustom, setStructuralCustom] = useState<string>('');
  const [repairCost, setRepairCost] = useState<number | null>(
    presetItem?.purchase_price ? Number(presetItem.purchase_price) : null,
  );
  const [chargeBack, setChargeBack] = useState(false);
  const [chargeFromGuest, setChargeFromGuest] = useState<number | null>(null);
  const [chargeFromPlatform, setChargeFromPlatform] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (presetItem) return;
    (async () => {
      const res = await listInventoryItems({ property_ids: [propertyId] });
      if (res.data) setItems(res.data);
    })();
  }, [propertyId, presetItem]);

  const selectedItem = useMemo(
    () => presetItem ?? items.find(i => i.id === itemId) ?? null,
    [presetItem, items, itemId],
  );

  // Pre-cargar costo cuando se selecciona un item con purchase_price.
  useEffect(() => {
    if (mode === 'inventory' && selectedItem?.purchase_price && (repairCost === null || repairCost === 0)) {
      setRepairCost(Number(selectedItem.purchase_price));
    }
  }, [mode, selectedItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectLabel = mode === 'inventory'
    ? (selectedItem?.name ?? '')
    : (structuralLabel === 'Otro' ? structuralCustom.trim() : structuralLabel);

  const canSubmit =
    !!repairCost && repairCost > 0 &&
    ((mode === 'inventory' && !!itemId) || (mode === 'structural' && !!subjectLabel));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    setErr(null);
    const res = await reportDamage({
      item_id: mode === 'inventory' ? itemId : null,
      item_name: subjectLabel,
      property_id: propertyId,
      booking_id: booking.id,
      repair_cost: repairCost ?? 0,
      description: description.trim() || null,
      charge_to_guest: chargeBack,
      charge_amount: (chargeFromGuest ?? 0) + (chargeFromPlatform ?? 0) || null,
      charge_from_guest: chargeFromGuest,
      charge_from_platform: chargeFromPlatform,
    });
    setSaving(false);
    if (res.error) { setErr(res.error); return; }
    await onSaved();
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">⚠ Registrar daño</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Reserva <strong className="font-mono">{booking.confirmation_code}</strong>
            {booking.guest_name && <> · {booking.guest_name}</>}
            {propertyName && <> · {propertyName}</>}
          </p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</p>}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 space-y-1">
            <p className="font-semibold">Al guardar:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>Se crea un <strong>gasto pendiente</strong> "Reparación …" vinculado a esta reserva.</li>
              <li>Si el daño es de inventario, el item queda <strong>marcado como dañado</strong>.</li>
              <li>Si activas el cobro, se agrega un <strong>cobro por daño</strong> a la reserva.</li>
              <li>Si ya hay un daño pendiente igual, no se duplicará.</li>
            </ul>
          </div>

          {/* Selector tipo de sujeto */}
          {!presetItem && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">¿Sobre qué fue el daño? *</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                <button
                  type="button" onClick={() => setMode('inventory')}
                  className={`flex-1 py-2 text-sm font-medium transition ${
                    mode === 'inventory' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >📦 Item de inventario</button>
                <button
                  type="button" onClick={() => setMode('structural')}
                  className={`flex-1 py-2 text-sm font-medium transition ${
                    mode === 'structural' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >🏠 Algo de la propiedad</button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Inventario: mobiliario, electrodomésticos, lencería, decoración, etc.
                <br />Propiedad: pared, estufa empotrada, piso, plomería… (no listado en inventario).
              </p>
            </div>
          )}

          {mode === 'inventory' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Item dañado *</label>
              {presetItem ? (
                <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg">
                  <strong>{presetItem.name}</strong>
                  {presetItem.location && <span className="text-slate-500"> · {presetItem.location}</span>}
                </div>
              ) : (
                <select
                  required value={itemId} onChange={e => setItemId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">— Selecciona un item del inventario —</option>
                  {items.map(it => (
                    <option key={it.id} value={it.id}>
                      {it.name}{it.location ? ` · ${it.location}` : ''}{it.status === 'damaged' ? ' (ya dañado)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {!presetItem && items.length === 0 && (
                <p className="text-[11px] text-amber-700 mt-1">
                  Esta propiedad aún no tiene items en inventario. Cambia a "Algo de la propiedad" o registra primero el inventario.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">¿Qué se dañó? *</label>
                <select
                  required value={structuralLabel} onChange={e => setStructuralLabel(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">— Selecciona —</option>
                  {STRUCTURAL_SUGGESTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {structuralLabel === 'Otro' && (
                <input
                  type="text" required placeholder="Describe (ej. zócalo madera sala)"
                  value={structuralCustom} onChange={e => setStructuralCustom(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Costo estimado de reparación / reposición *</label>
            <MoneyInput value={repairCost} onChange={setRepairCost} required placeholder="0" />
            <p className="text-[10px] text-slate-400 mt-1">
              Se registrará como gasto <strong>pendiente</strong>. Cuando lo arregles editas el monto real y lo marcas pagado.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción / detalle (opcional)</label>
            <input
              type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ej: rasguño profundo en respaldo, mancha de vino, golpe en esquina…"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={chargeBack} onChange={e => setChargeBack(e.target.checked)} />
              <span className="font-medium text-slate-700">Cobrar el daño (huésped y/o plataforma)</span>
            </label>
            {chargeBack && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">
                  Indica cuánto recibes (o esperas recibir) de cada fuente. Cada monto se registra como un
                  <code className="bg-white px-1 mx-0.5 rounded">damage_charge</code> en la reserva — son <b>ingresos</b>
                  que aumentan la rentabilidad de la reserva.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">👤 Cobro al huésped</label>
                    <MoneyInput value={chargeFromGuest} onChange={setChargeFromGuest} placeholder="0 (depósito, efectivo)" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">🏢 Cobro a la plataforma</label>
                    <MoneyInput value={chargeFromPlatform} onChange={setChargeFromPlatform} placeholder="0 (Airbnb resolution, etc.)" />
                  </div>
                </div>
                {(() => {
                  const cobrado = (chargeFromGuest ?? 0) + (chargeFromPlatform ?? 0);
                  const costo = repairCost ?? 0;
                  const neto = cobrado - costo;
                  if (cobrado === 0 && costo === 0) return null;
                  return (
                    <div className={`text-[11px] rounded px-2 py-1.5 border ${
                      neto >= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                      Cobrado: <b>{cobrado.toLocaleString('es-CO')}</b> − Costo: <b>{costo.toLocaleString('es-CO')}</b>
                      = Neto: <b>{neto.toLocaleString('es-CO')}</b>
                      {neto < 0 && <> · Te quedan debiendo</>}
                      {neto > 0 && <> · Sobrecobro a tu favor</>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving || !canSubmit}
              className="flex-1 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed">
              {saving ? 'Guardando…' : 'Registrar daño'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
