import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';

export default function CompleteBookingModal({
  checklist, working, error, onClose, onConfirm,
}: {
  checklist: {
    checkin: boolean;
    checkout: boolean;
    inventory: boolean;
    cleaning_assigned: boolean;
    cleaning_done: boolean;
    allDone: boolean;
  };
  working: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const items: { ok: boolean; label: string }[] = [
    { ok: checklist.checkin, label: 'Check-in realizado' },
    { ok: checklist.checkout, label: 'Check-out realizado' },
    { ok: checklist.inventory, label: 'Inventario revisado' },
    { ok: checklist.cleaning_assigned, label: 'Aseo asignado' },
    { ok: checklist.cleaning_done, label: 'Aseo hecho o pagado' },
  ];
  const missing = items.filter(i => !i.ok);

  return (
    <motion.div
      {...backdrop}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-5 border-b">
          <h3 className="text-lg font-bold text-slate-900">Marcar reserva como completada</h3>
          <p className="text-xs text-slate-500 mt-0.5">Revisa el checklist operativo antes de cerrar la reserva.</p>
        </div>

        <div className="p-6 space-y-4">
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  it.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                }`}>
                  {it.ok ? '✓' : '○'}
                </span>
                <span className={it.ok ? 'text-slate-800' : 'text-slate-500'}>{it.label}</span>
              </li>
            ))}
          </ul>

          {checklist.allDone ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
              Todo está en orden. La reserva se marcará como <strong>completada</strong>.
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
              <div className="font-semibold">Quedan {missing.length} tareas pendientes.</div>
              <div className="text-xs">
                Puedes completar la reserva de todos modos, pero quedará <strong>cerrada con pendientes</strong>. Las banderas faltantes seguirán visibles para que las termines luego.
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={working}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          {checklist.allDone ? (
            <button onClick={() => onConfirm(false)} disabled={working}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">
              {working ? 'Guardando…' : '✓ Completar'}
            </button>
          ) : (
            <button onClick={() => onConfirm(true)} disabled={working}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
              {working ? 'Guardando…' : 'Completar de todos modos'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
