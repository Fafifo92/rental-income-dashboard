'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import type { Vendor } from '@/services/vendors';

interface Props {
  cleaner: Vendor;
  hasCleanings: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}

export default function ConfirmDeleteModal({ cleaner, hasCleanings, onClose, onConfirm }: Props) {
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
            su historial se mantiene intacto. Puedes reactivarla desde &quot;Editar&quot;.
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
