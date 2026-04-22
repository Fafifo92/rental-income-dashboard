import { useState, useEffect } from 'react';
import { computeFinancials } from '@/services/financial';
import type { FinancialKPIs, MonthlyPnL } from '@/services/financial';
import { formatCurrency } from '@/lib/utils';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function now() {
  const d = new Date();
  return `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function KPIRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <tr className={highlight ? 'font-bold bg-slate-50' : ''}>
      <td className="py-2 pr-4 text-slate-600 text-sm">{label}</td>
      <td className="py-2 text-right text-slate-900 text-sm font-mono">{value}</td>
    </tr>
  );
}

export default function PrintReport() {
  const [kpis, setKpis]       = useState<FinancialKPIs | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPnL[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    computeFinancials('last-3-months').then(r => {
      setKpis(r.kpis);
      setMonthly(r.monthlyPnL);
      setLoading(false);
    });
  }, []);

  if (loading || !kpis) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-400 animate-pulse">Generando reporte…</p>
      </div>
    );
  }

  const margin = kpis.grossRevenue > 0 ? (kpis.netProfit / kpis.grossRevenue * 100).toFixed(1) : '0';

  return (
    <>
      {/* Print controls — hidden on print */}
      <div className="print:hidden fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-blue-700 transition-colors"
        >
          🖨️ Imprimir / Guardar PDF
        </button>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300 transition-colors"
        >
          ✕ Cerrar
        </button>
      </div>

      {/* Report body */}
      <div className="max-w-3xl mx-auto p-10 font-sans text-slate-900">

        {/* Header */}
        <div className="flex items-start justify-between mb-10 border-b-2 border-blue-600 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">A</div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">STR Analytics</h1>
            </div>
            <h2 className="text-lg font-bold text-slate-700">Reporte Financiero — Últimos 3 meses</h2>
            <p className="text-sm text-slate-400 mt-1">Generado: {now()}{kpis.isDemo && ' · Modo demo'}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold text-blue-700">{formatCurrency(kpis.netProfit)}</p>
            <p className="text-sm text-slate-500">Utilidad Neta</p>
            <p className={`text-sm font-semibold ${Number(margin) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              Margen: {margin}%
            </p>
          </div>
        </div>

        {/* KPI Summary */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Ingreso Bruto',   value: formatCurrency(kpis.grossRevenue),  color: 'bg-blue-50 border-blue-200' },
            { label: 'Total Gastos',    value: formatCurrency(kpis.totalExpenses),  color: 'bg-red-50 border-red-200' },
            { label: 'Ocupación',       value: `${(kpis.occupancyRate * 100).toFixed(1)}%`, color: 'bg-orange-50 border-orange-200' },
            { label: 'ADR',             value: formatCurrency(kpis.adr),            color: 'bg-slate-50 border-slate-200' },
            { label: 'RevPAR',          value: formatCurrency(kpis.revpar),         color: 'bg-purple-50 border-purple-200' },
            { label: 'Reservas',        value: String(kpis.totalBookings),          color: 'bg-green-50 border-green-200' },
          ].map(item => (
            <div key={item.label} className={`p-4 rounded-xl border ${item.color}`}>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{item.label}</p>
              <p className="text-lg font-extrabold text-slate-800 mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* P&L Waterfall */}
        <div className="mb-10">
          <h3 className="text-base font-bold text-slate-700 mb-3 border-b pb-2">Estado de Resultados</h3>
          <table className="w-full">
            <tbody>
              <KPIRow label="(+) Ingreso Bruto"         value={formatCurrency(kpis.grossRevenue)} />
              <KPIRow label="(−) Gastos Variables"      value={formatCurrency(kpis.totalVariableExpenses)} />
              <KPIRow label="(=) Margen de Contribución" value={formatCurrency(kpis.contributionMargin)} highlight />
              <KPIRow label="(−) Gastos Fijos"          value={formatCurrency(kpis.totalFixedExpenses)} />
              <KPIRow label="(=) Utilidad Neta"         value={formatCurrency(kpis.netProfit)} highlight />
            </tbody>
          </table>
        </div>

        {/* Monthly P&L Table */}
        <div className="mb-10">
          <h3 className="text-base font-bold text-slate-700 mb-3 border-b pb-2">Desglose Mensual</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {['Mes','Ingresos','Gastos','Utilidad Neta','Noches','Ocupación'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-slate-500 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map((row, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{row.month}</td>
                  <td className="py-2 text-right font-mono text-blue-700">{formatCurrency(row.revenue)}</td>
                  <td className="py-2 text-right font-mono text-red-600">{formatCurrency(row.expenses)}</td>
                  <td className={`py-2 text-right font-mono font-bold ${row.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(row.netProfit)}
                  </td>
                  <td className="py-2 text-right text-slate-500">{row.nights}</td>
                  <td className="py-2 text-right text-slate-500">{row.occupancy}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Break-even analysis */}
        <div className="mb-10">
          <h3 className="text-base font-bold text-slate-700 mb-3 border-b pb-2">Análisis de Break-even</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Noches necesarias (break-even)', value: `${kpis.breakEvenNights} noches` },
              { label: 'Ocupación necesaria',            value: `${kpis.breakEvenOccupancy}%` },
              { label: 'Ocupación real',                 value: `${(kpis.occupancyRate * 100).toFixed(1)}%` },
              { label: 'Estado',                         value: kpis.occupancyRate * 100 >= kpis.breakEvenOccupancy ? '✅ Sobre break-even' : '⚠️ Bajo break-even' },
            ].map(item => (
              <div key={item.label} className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-500">{item.label}</span>
                <span className="text-sm font-bold text-slate-800">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t pt-4 text-xs text-slate-400 flex justify-between">
          <span>STR Analytics — Plataforma de gestión financiera</span>
          <span>{new Date().toLocaleDateString('es-CO')}</span>
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 1.5cm; size: A4; }
        }
      `}</style>
    </>
  );
}
