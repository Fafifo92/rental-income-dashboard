import { motion } from 'framer-motion';
import type { Vendor } from '@/services/vendors';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

interface Props {
  vendor: Vendor;
  onConfirm: () => void;
  onClose: () => void;
}

export default function VendorConfirmDeleteModal({ vendor, onConfirm, onClose }: Props) {
  return (
    <motion.div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-2">Eliminar proveedor</h3>
        <p className="text-sm text-slate-600 mb-5">
          ¿Seguro que deseas eliminar <b>{vendor.name}</b>? Los gastos o aseos que lo referenciaban quedarán sin proveedor pero no se eliminarán.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700">Eliminar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
