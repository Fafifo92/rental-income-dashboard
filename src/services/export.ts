import { formatCurrency } from '@/lib/utils';
import type { FinancialKPIs, MonthlyPnL } from './financial';

// ─── CSV Export ───────────────────────────────────────────────────────────────

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsvRow(cells: (string | number)[]): string {
  return cells
    .map(c => {
      const s = String(c);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
}

export function exportKpisToCsv(kpis: FinancialKPIs, period: string) {
  const rows = [
    toCsvRow(['Métrica', 'Valor']),
    toCsvRow(['Período', period]),
    toCsvRow(['Ingreso Bruto',       kpis.grossRevenue]),
    toCsvRow(['Gastos Fijos',        kpis.totalFixedExpenses]),
    toCsvRow(['Gastos Variables',    kpis.totalVariableExpenses]),
    toCsvRow(['Total Gastos',        kpis.totalExpenses]),
    toCsvRow(['Margen Contribución', kpis.contributionMargin]),
    toCsvRow(['Utilidad Neta',       kpis.netProfit]),
    toCsvRow(['Ocupación %',         (kpis.occupancyRate * 100).toFixed(1)]),
    toCsvRow(['ADR',                 kpis.adr]),
    toCsvRow(['RevPAR',              kpis.revpar]),
    toCsvRow(['Noches Totales',      kpis.totalNights]),
    toCsvRow(['Break-even Noches',   kpis.breakEvenNights]),
    toCsvRow(['Break-even Ocu. %',   kpis.breakEvenOccupancy]),
    toCsvRow(['Total Reservas',      kpis.totalBookings]),
    toCsvRow(['Canceladas',          kpis.cancelledCount]),
  ];
  downloadFile(rows.join('\n'), `str-kpis-${today()}.csv`, 'text/csv;charset=utf-8;');
}

export function exportMonthlyToCsv(data: MonthlyPnL[]) {
  const rows = [
    toCsvRow(['Mes', 'Ingresos', 'Gastos', 'Utilidad Neta', 'Noches', 'Ocupación %']),
    ...data.map(d =>
      toCsvRow([d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.occupancy])
    ),
  ];
  downloadFile(rows.join('\n'), `str-pnl-mensual-${today()}.csv`, 'text/csv;charset=utf-8;');
}

// ─── Excel Export (SpreadsheetML XML — no external deps, zero vulnerabilities) ─

function escXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSpreadsheetML(
  sheets: Array<{ name: string; rows: (string | number | null | undefined)[][] }>
): string {
  const worksheets = sheets.map(({ name, rows }) => {
    const tableRows = rows.map(row => {
      const cells = row
        .map(cell => {
          if (cell === null || cell === undefined)
            return '<Cell><Data ss:Type="String"></Data></Cell>';
          const isNum = typeof cell === 'number';
          return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(String(cell))}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    }).join('');
    return `<Worksheet ss:Name="${escXml(name)}"><Table>${tableRows}</Table></Worksheet>`;
  }).join('');

  return [
    '<?xml version="1.0"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    worksheets,
    '</Workbook>',
  ].join('');
}

export function exportToExcel(kpis: FinancialKPIs, monthly: MonthlyPnL[], period: string) {
  const kpiRows: (string | number)[][] = [
    ['Métrica', 'Valor', 'Formato'],
    ['Período', period, ''],
    ['Ingreso Bruto',       kpis.grossRevenue,          formatCurrency(kpis.grossRevenue)],
    ['Gastos Fijos',        kpis.totalFixedExpenses,    formatCurrency(kpis.totalFixedExpenses)],
    ['Gastos Variables',    kpis.totalVariableExpenses, formatCurrency(kpis.totalVariableExpenses)],
    ['Total Gastos',        kpis.totalExpenses,         formatCurrency(kpis.totalExpenses)],
    ['Margen Contribución', kpis.contributionMargin,    formatCurrency(kpis.contributionMargin)],
    ['Utilidad Neta',       kpis.netProfit,             formatCurrency(kpis.netProfit)],
    ['Ocupación %',         +(kpis.occupancyRate * 100).toFixed(1), `${(kpis.occupancyRate * 100).toFixed(1)}%`],
    ['ADR',                 kpis.adr,                   formatCurrency(kpis.adr)],
    ['RevPAR',              kpis.revpar,                formatCurrency(kpis.revpar)],
    ['Noches Totales',      kpis.totalNights,           ''],
    ['Break-even Noches',   kpis.breakEvenNights,       ''],
    ['Break-even Ocu. %',   kpis.breakEvenOccupancy,    `${kpis.breakEvenOccupancy}%`],
    ['Total Reservas',      kpis.totalBookings,         ''],
    ['Canceladas',          kpis.cancelledCount,        ''],
  ];

  const monthRows: (string | number)[][] = [
    ['Mes', 'Ingresos (COP)', 'Gastos (COP)', 'Utilidad Neta (COP)', 'Noches', 'Ocupación %'],
    ...monthly.map(d => [d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.occupancy]),
  ];

  const xml = buildSpreadsheetML([
    { name: 'KPIs',        rows: kpiRows },
    { name: 'P&L Mensual', rows: monthRows },
  ]);

  downloadFile(xml, `str-reporte-${today()}.xls`, 'application/vnd.ms-excel');
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0];
}
