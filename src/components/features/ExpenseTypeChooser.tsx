'use client';
/**
 * Selector de tipo de gasto. Aparece como primer paso al pulsar "Registrar Gasto".
 * Encamina al usuario a flujos especializados:
 *   - Sobre propiedad (servicios, admin, mantenimiento, stock)
 *   - Compra puntual de insumos de aseo
 *   - Liquidación al personal de aseo (redirige a /aseo)
 *   - Daño durante una reserva (DamageReportModal con picker de reserva)
 *   - Pago a proveedor
 *
 * No persiste nada por sí mismo: notifica al padre qué flujo abrir.
 */
import { motion } from 'framer-motion';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import {
  Home, Sparkles, Wallet, AlertTriangle, Handshake, Wrench, ChevronRight,
} from 'lucide-react';

export type ExpenseTypeChoice =
  | 'property'
  | 'cleaning_supplies'
  | 'cleaning_payout'
  | 'damage'
  | 'vendor'
  | 'inventory_maintenance';

interface Props {
  onChoose: (choice: ExpenseTypeChoice) => void;
  onClose: () => void;
}

const OPTIONS: {
  id: ExpenseTypeChoice;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  accent: string;
}[] = [
  {
    id: 'property',
    icon: Home,
    title: 'Sobre una propiedad',
    description: 'Servicios públicos, administración, mantenimiento, stock e insumos no vinculados a un huésped.',
    accent: 'text-blue-700 bg-blue-50 border-blue-200',
  },
  {
    id: 'cleaning_payout',
    icon: Wallet,
    title: 'Liquidación a personal de aseo',
    description: 'Pagar a un cleaner por sus turnos hechos. Te llevamos a la pantalla de liquidación.',
    accent: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  },
  {
    id: 'cleaning_supplies',
    icon: Sparkles,
    title: 'Compra de insumos de aseo',
    description: 'Compra puntual de detergentes, blanqueadores, etc. (no liquidación de turno).',
    accent: 'text-cyan-700 bg-cyan-50 border-cyan-200',
  },
  {
    id: 'damage',
    icon: AlertTriangle,
    title: 'Daño durante una reserva',
    description: 'Daño sobre el inventario o estructura. Queda vinculado al item, la reserva y el cobro.',
    accent: 'text-rose-700 bg-rose-50 border-rose-200',
  },
  {
    id: 'vendor',
    icon: Handshake,
    title: 'Pago a proveedor',
    description: 'Carpintero, jardinero, contador, etc. Vinculado al proveedor y a la propiedad.',
    accent: 'text-violet-700 bg-violet-50 border-violet-200',
  },
  {
    id: 'inventory_maintenance',
    icon: Wrench,
    title: 'Mantenimiento de inventario',
    description: 'Registra el costo del mantenimiento de un item del inventario y cierra el agendamiento.',
    accent: 'text-amber-700 bg-amber-50 border-amber-200',
  },
];

export default function ExpenseTypeChooser({ onChoose, onClose }: Props) {
  return (
    <motion.div
      {...makeBackdropHandlers(onClose)}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">¿Qué tipo de gasto vas a registrar?</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Selecciona el tipo para abrir un formulario adecuado y mantener todo bien vinculado.
          </p>
        </div>
        <div className="p-4 grid gap-2">
          {OPTIONS.map(opt => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => onChoose(opt.id)}
                className={`group flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition hover:shadow-md hover:-translate-y-px ${opt.accent}`}
              >
                <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-tight">{opt.title}</div>
                  <div className="text-xs opacity-80 mt-0.5">{opt.description}</div>
                </div>
                <ChevronRight className="w-4 h-4 mt-1 opacity-50 group-hover:opacity-100 transition" />
              </button>
            );
          })}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
