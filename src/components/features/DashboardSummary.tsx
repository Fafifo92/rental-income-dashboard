import { formatCurrency } from '@/lib/utils';
import type { FinancialMetrics } from '@/types';
import { motion } from 'framer-motion';

export default function DashboardSummary({ metrics }: { metrics: FinancialMetrics }) {
  const items = [
    { label: 'Ingreso Bruto', value: formatCurrency(metrics.grossRevenue), color: 'text-blue-600' },
    { label: 'Gastos Totales', value: formatCurrency(metrics.totalExpenses), color: 'text-red-600' },
    { label: 'Utilidad Neta', value: formatCurrency(metrics.netProfit), color: 'text-green-600' },
    { label: 'ADR', value: formatCurrency(metrics.adr), color: 'text-slate-600' },
    { label: 'Ocupación', value: `${(metrics.occupancyRate * 100).toFixed(1)}%`, color: 'text-orange-600' },
    { label: 'RevPAR', value: formatCurrency(metrics.revpar), color: 'text-purple-600' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="p-6 bg-white border rounded-xl shadow-sm hover:shadow-md transition-shadow"
        >
          <p className="text-sm font-medium text-slate-500">{item.label}</p>
          <p className={`text-2xl font-bold mt-1 ${item.color}`}>{item.value}</p>
        </motion.div>
      ))}
    </div>
  );
}
