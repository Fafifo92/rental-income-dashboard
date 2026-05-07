import { motion, AnimatePresence } from 'framer-motion';
import type { MaintenanceScheduleRow, InventoryItemRow, PropertyRow } from '@/types/database';

interface Props {
  today: string;
  overdueMaintenance: MaintenanceScheduleRow[];
  upcomingMaintenance: MaintenanceScheduleRow[];
  doneNeedingExpense: MaintenanceScheduleRow[];
  inventoryItemsMap: Map<string, InventoryItemRow>;
  properties: PropertyRow[];
  onRegisterMaintenance: (schedule: MaintenanceScheduleRow) => void;
}

/**
 * Dos paneles colapsables: mantenimientos próximos/vencidos y mantenimientos
 * realizados sin gasto registrado. Stateless — el padre maneja el flujo.
 */
export default function MaintenancePanels({
  today, overdueMaintenance, upcomingMaintenance, doneNeedingExpense,
  inventoryItemsMap, properties, onRegisterMaintenance,
}: Props) {
  return (
    <>
      <AnimatePresence>
        {(overdueMaintenance.length > 0 || upcomingMaintenance.length > 0) && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-orange-200 bg-orange-50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-orange-900 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                  🔧 Mantenimientos del inventario
                  {overdueMaintenance.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 bg-red-200 text-red-800 rounded-full">
                      {overdueMaintenance.length} vencido{overdueMaintenance.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {upcomingMaintenance.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 bg-orange-200 text-orange-800 rounded-full">
                      {upcomingMaintenance.length} próximo{upcomingMaintenance.length > 1 ? 's' : ''}
                    </span>
                  )}
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...overdueMaintenance, ...upcomingMaintenance].map((s, i) => {
                  const item = inventoryItemsMap.get(s.item_id);
                  const isOverdue = s.scheduled_date <= today;
                  const prop = properties.find(p => p.id === s.property_id);
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className={`bg-white rounded-lg p-4 border shadow-sm ${isOverdue ? 'border-red-200' : 'border-orange-100'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-slate-800 text-sm truncate">{item?.name ?? 'Item eliminado'}</p>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border whitespace-nowrap ${
                              isOverdue
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-orange-50 text-orange-700 border-orange-200'
                            }`}>
                              {isOverdue ? '🔴 VENCIDO' : '🟡 PRÓXIMO'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 truncate">{s.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{prop?.name ?? ''} · Fecha: {s.scheduled_date}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegisterMaintenance(s)}
                        className="mt-3 w-full text-xs font-semibold px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        + Registrar gasto de mantenimiento
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {doneNeedingExpense.length > 0 && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-blue-900 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                  📋 Mantenimientos realizados sin gasto
                  <span className="text-xs font-semibold px-2 py-0.5 bg-blue-200 text-blue-800 rounded-full">
                    {doneNeedingExpense.length}
                  </span>
                </h3>
                <span className="text-xs text-blue-700">Registra el costo real del mantenimiento</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {doneNeedingExpense.map((s, i) => {
                  const item = inventoryItemsMap.get(s.item_id);
                  const prop = properties.find(p => p.id === s.property_id);
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white rounded-lg p-4 border border-blue-100 shadow-sm"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-slate-800 text-sm truncate">{item?.name ?? 'Item eliminado'}</p>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-blue-50 text-blue-700 border-blue-200 whitespace-nowrap">
                            ✅ REALIZADO
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">{s.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{prop?.name ?? ''} · Completado: {s.scheduled_date}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegisterMaintenance(s)}
                        className="mt-3 w-full text-xs font-semibold px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        💰 Registrar el gasto
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
