import { motion } from 'framer-motion';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';

interface Props {
  expense: Expense;
  properties?: PropertyRow[];
  bankAccounts?: BankAccountRow[];
  onClose: () => void;
  onEdit?: (expense: Expense) => void;
  /** Si se provee, aparece botón "Ver reserva" al lado del chip. */
  onViewBooking?: (bookingId: string) => void;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  paid:    { label: 'Pagado',    className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  partial: { label: 'Parcial',   className: 'bg-orange-100 text-orange-800 border-orange-200' },
};

const kindOf = (id: string): 'real' | 'recurring' | 'fees' => {
  if (id.startsWith('rec-')) return 'recurring';
  if (id.startsWith('fee-')) return 'fees';
  return 'real';
};

export default function ExpenseDetailModal({
  expense, properties = [], bankAccounts = [], onClose, onEdit, onViewBooking,
}: Props) {
  const kind = kindOf(expense.id);
  const isSynthetic = kind !== 'real';
  const property = expense.property_id ? properties.find(p => p.id === expense.property_id) : null;
  const bank = expense.bank_account_id ? bankAccounts.find(b => b.id === expense.bank_account_id) : null;
  const status = STATUS_LABEL[expense.status] ?? { label: expense.status, className: 'bg-slate-100 text-slate-700' };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        {/* Encabezado factura */}
        <div className="px-7 py-5 border-b bg-gradient-to-r from-slate-50 to-white flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Comprobante de Gasto</p>
            <h2 className="text-2xl font-extrabold text-slate-900 mt-1">{expense.category}</h2>
            <p className="text-xs text-slate-500 font-mono mt-1">#{expense.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Banner para sintéticos */}
        {isSynthetic && (
          <div className={`px-7 py-2.5 text-xs font-medium border-b ${
            kind === 'recurring' ? 'bg-purple-50 text-purple-800 border-purple-100' : 'bg-rose-50 text-rose-800 border-rose-100'
          }`}>
            {kind === 'recurring'
              ? '⤷ Entrada automática generada desde un Gasto Recurrente de la propiedad.'
              : '⤷ Comisión del canal (Airbnb/Booking/etc.) calculada desde una reserva.'}
          </div>
        )}

        {/* Monto destacado */}
        <div className="px-7 py-6 border-b">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Monto</p>
          <p className="text-4xl font-extrabold text-slate-900 mt-1 tabular-nums">{formatCurrency(expense.amount)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${status.className}`}>
              {status.label}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              expense.type === 'fixed' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
            }`}>
              {expense.type === 'fixed' ? 'Gasto fijo' : 'Gasto variable'}
            </span>
          </div>
        </div>

        {/* Detalle tipo factura */}
        <div className="px-7 py-5 grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
          <Row label="Fecha" value={expense.date} />
          <Row label="Propiedad" value={property ? property.name : 'General / sin asignar'} />
          <Row label="Proveedor" value={expense.vendor ?? '—'} />
          <Row label="A cargo de" value={expense.person_in_charge ?? '—'} />
          <Row label="Pagado desde"
               value={bank ? `${bank.name}${bank.bank ? ` (${bank.bank})` : ''}` : '—'} />
          <Row label="Categoría" value={expense.category} />
          {expense.booking_id && (
            <div className="col-span-2">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Vinculado a reserva</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-slate-800 font-mono text-xs bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 inline-block">
                  {expense.booking_id.slice(0, 8).toUpperCase()}
                </span>
                {onViewBooking && (
                  <button
                    onClick={() => onViewBooking(expense.booking_id!)}
                    className="text-xs text-indigo-700 hover:text-indigo-900 underline font-medium"
                  >
                    Ver reserva →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Descripción larga */}
        <div className="px-7 pb-5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Descripción</p>
          <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 min-h-[3rem] whitespace-pre-wrap">
            {expense.description || <span className="text-slate-400 italic">Sin descripción</span>}
          </p>
        </div>

        {/* Acciones */}
        <div className="px-7 py-4 bg-slate-50 border-t flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {isSynthetic
              ? 'Editable desde el origen (propiedad o reserva).'
              : 'Puedes editar o eliminar este gasto.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white"
            >
              Cerrar
            </button>
            {onEdit && !isSynthetic && (
              <button
                onClick={() => onEdit(expense)}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Editar
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-slate-800 mt-0.5 break-words">{value}</p>
    </div>
  );
}
