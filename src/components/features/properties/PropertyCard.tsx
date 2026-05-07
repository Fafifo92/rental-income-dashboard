'use client';
import { motion } from 'framer-motion';
import { CATEGORY_COLORS, resolveColor, type Property, type PropertyGroupRow, type PropertyTagRow } from './propertyTypes';

interface Props {
  property: Property;
  index: number;
  isDemo: boolean;
  group?: PropertyGroupRow;
  tags?: PropertyTagRow[];
  onEdit?: () => void;
}

export default function PropertyCard({ property, index, isDemo, group, tags, onEdit }: Props) {
  const colorClass = CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={`h-2 bg-gradient-to-r ${colorClass}`} />

      <div className="p-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="font-bold text-slate-800 text-lg leading-tight truncate flex-1">{property.name}</h3>
            {group && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={{
                  backgroundColor: resolveColor(group.color) + '18',
                  borderColor: resolveColor(group.color) + '50',
                  color: resolveColor(group.color),
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: resolveColor(group.color) }} />
                {group.name}
              </span>
            )}
          </div>
          {property.address && (
            <p className="text-slate-500 text-sm mt-1 truncate">{property.address}</p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map(t => (
                <span
                  key={t.id}
                  className="px-1.5 py-0.5 text-[10px] font-medium rounded border"
                  style={{
                    backgroundColor: resolveColor(t.color) + '18',
                    borderColor: resolveColor(t.color) + '50',
                    color: resolveColor(t.color),
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {isDemo && (
            <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              Datos demo
            </span>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-4 gap-2">
          {!isDemo && (
            <a
              href={`/property-detail?id=${property.id}`}
              className="text-center text-xs font-medium text-blue-600 hover:text-blue-800 py-2 px-1 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Config.
            </a>
          )}
          {!isDemo && onEdit && (
            <button
              onClick={onEdit}
              title="Asignar grupo y etiquetas"
              className="text-center text-xs font-medium text-violet-600 hover:text-violet-800 py-2 px-1 rounded-lg hover:bg-violet-50 transition-colors"
            >
              Organizar
            </button>
          )}
          <a
            href={`/bookings?property=${property.id}`}
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-1 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Reservas
          </a>
          <a
            href={`/expenses?property=${property.id}`}
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-1 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Gastos
          </a>
        </div>
      </div>
    </motion.div>
  );
}
