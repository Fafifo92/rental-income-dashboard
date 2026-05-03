'use client';
/**
 * Pestaña "Ingresos vs Egresos" del Dashboard.
 *
 * Muestra:
 *  - 4 KPIs: Payout confirmado, Por cobrar, Total egresos, Utilidad real
 *  - Gráfica mensual con 4 series:
 *      · Ingreso confirmado  (barra verde sólida)
 *      · Ingreso esperado    (barra verde rayada — dato aproximado)
 *      · Egresos             (barra roja sólida)
 *      · Net confirmado      (línea morada)
 *  - Banner de reservas con datos incompletos
 *  - Nota metodológica
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { PayoutBreakdown, FinancialKPIs, ChartGranularity } from '@/services/financial';
import { formatCurrency } from '@/lib/utils';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Props {
  payout: PayoutBreakdown;
  kpis: FinancialKPIs;
  granularity?: ChartGranularity;
}

// ── Tooltip personalizado ─────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-sm min-w-[180px]">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-slate-500">{p.name}</span>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {formatCurrency(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── KPI mini-card ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string | null; tone: 'green' | 'amber' | 'red' | 'purple' }) {
  const colors: Record<typeof tone, string> = {
    green:  'bg-green-50  border-green-100  text-green-700',
    amber:  'bg-amber-50  border-amber-100  text-amber-700',
    red:    'bg-rose-50   border-rose-100   text-rose-700',
    purple: 'bg-violet-50 border-violet-100 text-violet-700',
  };
  return (
    <div className={`p-5 border rounded-xl shadow-sm ${colors[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-extrabold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function IncomeExpenseTab({ payout, kpis, granularity = 'month' }: Props) {
  const { received, expected, incompleteCount, monthlyBreakdown } = payout;
  const netConfirmed = received - kpis.totalExpenses;
  const completenessRate = received + expected > 0
    ? Math.round((received / (received + expected)) * 100)
    : 0;

  const granularityLabel: Record<ChartGranularity, string> = {
    day: 'por día', week: 'por semana', month: 'por mes',
  };

  return (
    <div className="space-y-6">
      {/* Banner incompletos */}
      {incompleteCount > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
          <div className="w-2 h-2 mt-1 rounded-full bg-amber-500 shrink-0" />
          <div>
            <p className="font-semibold text-amber-800 mb-0.5">
              {incompleteCount} reserva{incompleteCount !== 1 ? 's' : ''} con datos incompletos
            </p>
            <p className="text-amber-700 text-xs">
              Son reservas pasadas sin cuenta bancaria de payout asignada.
              Su ingreso aparece como <strong>Esperado</strong> (dato aproximado) hasta que
              confirmes el payout desde la sección Reservas.
              El {completenessRate}% de tus ingresos del periodo están contabilizados.
            </p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          tone="green"
          label="Payout confirmado"
          value={formatCurrency(received)}
          sub="Ingreso real recibido"
        />
        <KpiCard
          tone="amber"
          label="Por cobrar / sin confirmar"
          value={formatCurrency(expected)}
          sub={incompleteCount > 0 ? `${incompleteCount} reservas sin banco asignado` : undefined}
        />
        <KpiCard
          tone="red"
          label="Total egresos"
          value={formatCurrency(kpis.totalExpenses)}
          sub={`Fijos: ${formatCurrency(kpis.totalFixedExpenses)} · Variables: ${formatCurrency(kpis.totalVariableExpenses)}`}
        />
        <KpiCard
          tone="purple"
          label="Utilidad confirmada"
          value={formatCurrency(netConfirmed)}
          sub={netConfirmed >= 0 ? `${Math.round((netConfirmed / Math.max(received, 1)) * 100)}% margen sobre recibido` : 'Gastos superan ingresos confirmados'}
        />
      </div>

      {/* Chart */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <h3 className="font-bold text-slate-800">Ingresos vs Egresos {granularityLabel[granularity]}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Verde sólido = confirmado · Verde rayado = esperado (sin confirmar) · Rojo = egresos · Línea = utilidad real
            </p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={monthlyBreakdown} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="22%"
          >
            <defs>
              {/* Patrón de rayas para ingresos esperados */}
              <pattern id="stripeExpected" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#86efac" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#16a34a" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${(v / 1_000_000).toFixed(0)}M`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={55} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value) => <span style={{ color: '#475569', fontSize: 12 }}>{value}</span>}
              wrapperStyle={{ paddingTop: 8 }}
            />
            <Bar dataKey="received"  name="Ingreso confirmado" fill="#16a34a" radius={[3,3,0,0]} maxBarSize={40} stackId="income" />
            <Bar dataKey="expected"  name="Ingreso esperado"   fill="url(#stripeExpected)" radius={[3,3,0,0]} maxBarSize={40} stackId="income" />
            <Bar dataKey="expenses"  name="Egresos"            fill="#ef4444" radius={[3,3,0,0]} maxBarSize={40} opacity={0.85} />
            <Line
              type="monotone"
              dataKey="netConfirmed"
              name="Utilidad confirmada"
              stroke="#7c3aed"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#7c3aed' }}
              activeDot={{ r: 5 }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Nota metodológica */}
      <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 space-y-1">
        <p>
          <strong className="text-slate-600">¿Cómo se calcula?</strong>{' '}
          &quot;Payout confirmado&quot; = suma de <code>net_payout</code> de reservas con cuenta bancaria asignada.
          &quot;Por cobrar&quot; = suma de <code>total_revenue</code> de reservas activas sin banco asignado.
          Asignar la cuenta en cada reserva (botón de payout) mueve el ingreso de &quot;esperado&quot; a &quot;confirmado&quot;.
        </p>
        <p>
          Los egresos incluyen todos los gastos del periodo (fijos, variables y comisiones de canal).
          La utilidad confirmada refleja lo que realmente tienes: lo recibido menos lo gastado.
        </p>
      </div>
    </div>
  );
}
