import { motion } from 'framer-motion';
import type { Property } from '@/types';

export default function PropertiesList({ properties }: { properties: Property[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {properties.map((property, i) => (
        <motion.div
          key={property.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="bg-white border rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer group"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 font-bold text-lg">
              {property.name.charAt(0)}
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-500">
              {property.base_currency}
            </span>
          </div>
          <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
            {property.name}
          </h3>
          {property.address && (
            <p className="text-sm text-slate-500 mt-1 truncate">{property.address}</p>
          )}
          <div className="mt-4 pt-4 border-t flex gap-4 text-xs text-slate-400">
            <span>0 reservas</span>
            <span>0 anuncios</span>
          </div>
        </motion.div>
      ))}

      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: properties.length * 0.1 }}
        className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-6 hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 min-h-[160px] group"
      >
        <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center text-slate-400 group-hover:text-blue-500 text-2xl transition-colors">
          +
        </div>
        <span className="text-sm font-medium text-slate-400 group-hover:text-blue-600 transition-colors">
          Agregar Propiedad
        </span>
      </motion.button>
    </div>
  );
}
