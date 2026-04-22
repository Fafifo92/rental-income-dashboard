import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';
import type { FinancialKPIs, MonthlyPnL } from '@/services/financial';

// ─── Alert type ───────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  level: 'error' | 'warning' | 'info';
  icon: string;
  title: string;
  body: string;
}

function buildAlerts(kpis: FinancialKPIs, monthly: MonthlyPnL[]): Alert[] {
  const alerts: Alert[] = [];
  const currentOcc = Math.round(kpis.occupancyRate * 100);

  // 1. Break-even alert
  if (kpis.breakEvenOccupancy > 0 && currentOcc < kpis.breakEvenOccupancy) {
    const shortfall = kpis.breakEvenNights - kpis.totalNights;
    alerts.push({
      id: 'break-even',
      level: currentOcc < kpis.breakEvenOccupancy * 0.7 ? 'error' : 'warning',
      icon: '⚠️',
      title: 'Debajo del punto de equilibrio',
      body: `Ocupación actual ${currentOcc}% — necesitas ${kpis.breakEvenNights} noches (${kpis.breakEvenOccupancy}%) para cubrir costos fijos. Faltan ${shortfall} noches.`,
    });
  }

  // 2. Maintenance ratio alert (maintenance expenses > 15% of revenue)
  if (kpis.grossRevenue > 0) {
    const maintenanceProxy = kpis.totalVariableExpenses * 0.3; // rough estimate
    const ratio = maintenanceProxy / kpis.grossRevenue;
    if (ratio > 0.15) {
      alerts.push({
        id: 'maintenance',
        level: 'warning',
        icon: '🔧',
        title: 'Gastos variables altos',
        body: `Los gastos variables representan el ${(kpis.totalVariableExpenses / kpis.grossRevenue * 100).toFixed(1)}% de tus ingresos. Considera revisar costos de limpieza y mantenimiento.`,
      });
    }
  }

  // 3. Net profit negative
  if (kpis.netProfit < 0) {
    alerts.push({
      id: 'net-loss',
      level: 'error',
      icon: '🔴',
      title: 'Período en pérdida',
      body: `Utilidad neta negativa: ${formatCurrency(kpis.netProfit)}. Los gastos totales superan los ingresos por ${formatCurrency(Math.abs(kpis.netProfit))}.`,
    });
  }

  // 4. ADR trend — check if last month is below period ADR
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    if (prev.nights > 0 && last.nights > 0) {
      const lastADR = last.revenue / last.nights;
      const prevADR = prev.revenue / prev.nights;
      if (lastADR < prevADR * 0.85) {
        alerts.push({
          id: 'adr-drop',
          level: 'warning',
          icon: '📉',
          title: 'Caída de tarifa diaria (ADR)',
          body: `La tarifa del mes ${last.month} (${formatCurrency(lastADR)}/noche) cayó más del 15% vs ${prev.month} (${formatCurrency(prevADR)}/noche).`,
        });
      }
    }
  }

  // 5. High occupancy (positive alert)
  if (currentOcc >= 85) {
    alerts.push({
      id: 'high-occ',
      level: 'info',
      icon: '🌟',
      title: '¡Excelente ocupación!',
      body: `${currentOcc}% de ocupación — considera subir tarifas para maximizar RevPAR (actualmente ${formatCurrency(kpis.revpar)}/noche disponible).`,
    });
  }

  return alerts;
}

const LEVEL_STYLES = {
  error:   { bg: 'bg-red-50',    border: 'border-red-200',   title: 'text-red-800',   body: 'text-red-700'   },
  warning: { bg: 'bg-amber-50',  border: 'border-amber-200', title: 'text-amber-800', body: 'text-amber-700' },
  info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  title: 'text-blue-800',  body: 'text-blue-700'  },
};

interface Props {
  kpis: FinancialKPIs;
  monthly: MonthlyPnL[];
}

export default function AlertsPanel({ kpis, monthly }: Props) {
  const alerts = buildAlerts(kpis, monthly);
  if (alerts.length === 0) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
        Alertas ({alerts.length})
      </h3>
      <AnimatePresence>
        {alerts.map((alert, i) => {
          const s = LEVEL_STYLES[alert.level];
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ delay: i * 0.08 }}
              className={`flex items-start gap-3 p-4 rounded-xl border ${s.bg} ${s.border}`}
            >
              <span className="text-xl shrink-0 mt-0.5">{alert.icon}</span>
              <div>
                <p className={`text-sm font-bold ${s.title}`}>{alert.title}</p>
                <p className={`text-xs mt-0.5 leading-relaxed ${s.body}`}>{alert.body}</p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}
