'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  listInventoryMovements,
  MOVEMENT_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
} from '@/services/inventory';
import type {
  InventoryItemRow,
  InventoryItemStatus,
  InventoryMovementRow,
  InventoryMovementType,
} from '@/types/database';
import { useBackdropClose } from '@/lib/useBackdropClose';
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
export function QuickMovementModal({
  item, type, onClose, onSave,
}: {
  item: InventoryItemRow;
  type: InventoryMovementType;
  onClose: () => void;
  onSave: (qtyDelta: number, newStatus: InventoryItemStatus | null, notes: string | null) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [qty, setQty] = useState<number | null>(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const labelByType: Record<InventoryMovementType, { title: string; help: string; sign: number; defaultStatus: InventoryItemStatus | null }> = {
    added:         { title: 'Agregar al inventario',     help: 'Suma cantidad al item.',                                              sign:  1, defaultStatus: null },
    used:          { title: 'Registrar consumo',         help: 'Resta cantidad. Si llega a 0 se marca como "Agotado" automáticamente.', sign: -1, defaultStatus: null },
    damaged:       { title: 'Reportar daño',             help: 'Marca el item como dañado. La cantidad no cambia (usa "Descartar" si lo botas).', sign: 0, defaultStatus: 'damaged' },
    repaired:      { title: 'Marcar como reparado',      help: 'Vuelve el estado a "Bueno".',                                          sign:  0, defaultStatus: 'good' },
    restocked:     { title: 'Reponer stock',             help: 'Suma cantidad. Útil tras compra de insumos.',                          sign:  1, defaultStatus: 'good' },
    discarded:     { title: 'Descartar (botar)',         help: 'Resta cantidad y marca dañado/perdido si aplica.',                     sign: -1, defaultStatus: null },
    lost:          { title: 'Marcar como perdido',       help: 'Marca el item como perdido.',                                          sign:  0, defaultStatus: 'lost' },
    status_change: { title: 'Cambiar estado',            help: 'Cambia el estado sin afectar cantidad.',                               sign:  0, defaultStatus: null },
  };
  const cfg = labelByType[type];
  const showQty = cfg.sign !== 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const delta = showQty ? cfg.sign * (qty ?? 0) : 0;
    const error = await onSave(delta, cfg.defaultStatus, notes.trim() || null);
    setSaving(false);
    if (error) setErr(error);
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-1">{cfg.title}</h3>
        <p className="text-xs text-slate-500 mb-1">{item.name} · stock actual: <strong>{Number(item.quantity)} {item.unit ?? ''}</strong></p>
        <p className="text-xs text-slate-500 mb-4 italic">{cfg.help}</p>

        <form onSubmit={submit} className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}
          {showQty && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Cantidad ({cfg.sign > 0 ? '+' : 'ÔêÆ'})
              </label>
              <input
                type="number" step="0.01" min="0" value={qty ?? ''} autoFocus
                onChange={e => setQty(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Detalles del movimiento (opcional)"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'GuardandoÔÇª' : 'Confirmar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
export function MovementsModal({ item, onClose }: { item: InventoryItemRow; onClose: () => void }) {
  const backdrop = useBackdropClose(onClose);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInventoryMovements(item.id).then(res => {
      if (res.data) setMovements(res.data);
      setLoading(false);
    });
  }, [item.id]);

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">­ƒô£ Historial de "{item.name}"</h3>
          <p className="text-xs text-slate-500">Bitácora completa de movimientos.</p>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500">CargandoÔÇª</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">Sin movimientos registrados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {movements.map(m => {
                const delta = Number(m.quantity_delta);
                return (
                  <li key={m.id} className="py-3 flex items-start gap-3">
                    <div className="text-xs text-slate-500 w-28 shrink-0">
                      {new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">{MOVEMENT_LABEL[m.type]}</span>
                        {delta !== 0 && (
                          <span className={`text-xs font-mono ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {delta > 0 ? '+' : ''}{delta} {item.unit ?? ''}
                          </span>
                        )}
                        {m.new_status && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[m.new_status]}`}>
                            ÔåÆ {STATUS_LABEL[m.new_status]}
                          </span>
                        )}
                      </div>
                      {m.notes && <p className="text-xs text-slate-500 mt-0.5">{m.notes}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
