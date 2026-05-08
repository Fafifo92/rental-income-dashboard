import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import { Wrench, Trash2, CheckCircle2 } from 'lucide-react';
import type { InventoryItemRow, MaintenanceScheduleRow } from '@/types/database';
import {
  createMaintenanceSchedule,
  updateMaintenanceSchedule,
  deleteMaintenanceSchedule,
  completeMaintenanceSchedule,
} from '@/services/maintenanceSchedules';

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDateLocal(iso: string): string {
  // Convert 'YYYY-MM-DD' coming from DB (UTC date) to local input value
  return iso.slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  item: InventoryItemRow;
  propertyName: string;
  /** Existing schedule to edit, or null to create */
  schedule?: MaintenanceScheduleRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ScheduleMaintenanceModal({
  item,
  propertyName,
  schedule,
  onClose,
  onSaved,
}: Props) {
  const backdrop = useBackdropClose(onClose);
  const isEdit = Boolean(schedule);

  const [title, setTitle]       = useState(schedule?.title ?? '');
  const [desc, setDesc]         = useState(schedule?.description ?? '');
  const [date, setDate]         = useState(schedule ? parseDateLocal(schedule.scheduled_date) : todayIso());
  const [notifyDays, setNotifyDays] = useState(schedule?.notify_before_days ?? 3);
  const [isRecurring, setIsRecurring] = useState(schedule?.is_recurring ?? false);
  const [recurrenceDays, setRecurrenceDays] = useState<number>(schedule?.recurrence_days ?? 30);

  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [completing,setCompleting]= useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  // Reset if schedule prop changes (e.g. parent swaps target)
  useEffect(() => {
    setTitle(schedule?.title ?? '');
    setDesc(schedule?.description ?? '');
    setDate(schedule ? parseDateLocal(schedule.scheduled_date) : todayIso());
    setNotifyDays(schedule?.notify_before_days ?? 3);
    setIsRecurring(schedule?.is_recurring ?? false);
    setRecurrenceDays(schedule?.recurrence_days ?? 30);
    setErr(null);
  }, [schedule]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('El título es obligatorio.'); return; }
    if (!date)         { setErr('La fecha es obligatoria.'); return; }
    if (date < todayIso()) { setErr('No puedes agendar mantenimiento en una fecha pasada.'); return; }

    setSaving(true);
    setErr(null);

    let result: { error: string | null };

    if (isEdit && schedule) {
      result = await updateMaintenanceSchedule(schedule.id, {
        title:              title.trim(),
        description:        desc.trim() || null,
        scheduled_date:     date,
        notify_before_days: notifyDays,
        is_recurring:       isRecurring,
        recurrence_days:    isRecurring ? recurrenceDays : null,
      });
    } else {
      result = await createMaintenanceSchedule({
        item_id:            item.id,
        property_id:        item.property_id,
        title:              title.trim(),
        description:        desc.trim() || null,
        scheduled_date:     date,
        notify_before_days: notifyDays,
        is_recurring:       isRecurring,
        recurrence_days:    isRecurring ? recurrenceDays : null,
      });
    }

    setSaving(false);
    if (result.error) { setErr(result.error); return; }
    onSaved();
  };

  const handleDelete = async () => {
    if (!schedule) return;
    if (!confirm('¿Eliminar este agendamiento? No se puede deshacer.')) return;
    setDeleting(true);
    const { error } = await deleteMaintenanceSchedule(schedule.id);
    setDeleting(false);
    if (error) { setErr(error); return; }
    onSaved();
  };

  const handleComplete = async () => {
    if (!schedule) return;
    setCompleting(true);
    const { error } = await completeMaintenanceSchedule(schedule.id, { expenseRegistered: false });
    setCompleting(false);
    if (error) { setErr(error); return; }
    onSaved();
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-bold text-slate-800">
            {isEdit ? 'Editar mantenimiento' : 'Agendar mantenimiento'}
          </h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          <span className="font-medium">{item.name}</span>
          {' · '}{propertyName}
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {err}
            </p>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Título <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ej. Revisión de calefacción"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Descripción <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Detalles del mantenimiento…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none resize-none"
            />
          </div>

          {/* Scheduled date */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Fecha programada <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={date}
              min={todayIso()}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
            />
          </div>

          {/* Notify before days */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Avisar con anticipación
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={90}
                value={notifyDays}
                onChange={e => setNotifyDays(Math.max(0, Number(e.target.value)))}
                className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              />
              <span className="text-xs text-slate-500">días antes</span>
            </div>
          </div>

          {/* Recurrencia */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-700">🔁 Mantenimiento recurrente</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Al completarlo, se agenda automáticamente el siguiente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecurring(v => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  isRecurring ? 'bg-amber-500' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  isRecurring ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            {isRecurring && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Repetir cada</span>
                <input
                  type="number"
                  value={recurrenceDays}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1) setRecurrenceDays(v);
                    else if (e.target.value === '') setRecurrenceDays(1);
                  }}
                  className="w-20 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <span className="text-xs text-slate-500">días (mín. 1)</span>
              </div>
            )}
          </div>

          {/* Email notify — disabled / coming soon */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold text-slate-600">Notificación por email</p>
              <p className="text-[11px] text-slate-400">Recibirás un recordatorio cuando se acerque la fecha.</p>
            </div>
            <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full whitespace-nowrap">
              Próximamente
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
            {/* Secondary actions (edit mode) */}
            <div className="flex items-center gap-1">
              {isEdit && schedule?.status === 'pending' && (
                <>
                  <button
                    type="button"
                    onClick={handleComplete}
                    disabled={completing}
                    title="Marcar como realizado"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {completing ? 'Guardando…' : 'Realizado'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    title="Eliminar agendamiento"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleting ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </>
              )}
            </div>

            {/* Primary actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Agendar'}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
