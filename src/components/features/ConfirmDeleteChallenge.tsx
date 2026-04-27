'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';

interface Props {
  title: string;
  description?: React.ReactNode;
  challenge?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Modal de confirmación con reto: el usuario debe escribir exactamente
 * la palabra `challenge` (por defecto "BORRAR") para habilitar el botón
 * de confirmación. Previene borrados accidentales.
 */
export default function ConfirmDeleteChallenge({
  title,
  description,
  challenge = 'BORRAR',
  confirmLabel = 'Eliminar definitivamente',
  destructive = true,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const canConfirm = text === challenge && !working;
  const backdrop = useBackdropClose(onCancel);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setWorking(true);
    try { await onConfirm(); }
    finally { setWorking(false); }
  };

  return (
    <motion.div
      {...backdrop}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
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
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Esta acción es irreversible.</p>
        </div>
        <div className="p-6 space-y-4">
          {description && <div className="text-sm text-slate-700">{description}</div>}

          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
            Para confirmar, escribe{' '}
            <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-red-300">
              {challenge}
            </code>{' '}
            en mayúsculas.
          </div>

          <div>
            <input
              type="text"
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={challenge}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tracking-wide focus:ring-2 focus:ring-red-500 outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button
            onClick={onCancel}
            disabled={working}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'
            } disabled:bg-slate-300 disabled:cursor-not-allowed`}
          >
            {working ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
