import { motion } from 'framer-motion';
import type { Expense } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

interface Props {
  target: Expense;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteExpenseConfirm({ target, onCancel, onConfirm }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      {...makeBackdropHandlers(onCancel)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-900 mb-2">¿Eliminar gasto?</h3>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-800">
            <span className="font-semibold">{target.category}</span> — {formatCurrency(target.amount)}
          </p>
          <p className="text-xs text-red-600 mt-1">{formatDateDisplay(target.date)}{target.description ? ` · ${target.description}` : ''}</p>
        </div>
        <p className="text-sm text-slate-500 mb-5">Esta acción es irreversible.</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
