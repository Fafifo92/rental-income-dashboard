import { formatCurrency } from '@/lib/utils';
import { todayISO } from '@/lib/dateUtils';
import type { FinancialKPIs, MonthlyPnL } from './financial';
import type { InventoryItemRow } from '@/types/database';

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
  downloadUtf8Csv(rows.join('\n'), `str-kpis-${today()}.csv`);
}

export function exportMonthlyToCsv(data: MonthlyPnL[]) {
  const rows = [
    toCsvRow(['Mes', 'Ingresos', 'Gastos', 'Utilidad Neta', 'Noches', 'Ocupación %']),
    ...data.map(d =>
      toCsvRow([d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.occupancy])
    ),
  ];
  downloadUtf8Csv(rows.join('\n'), `str-pnl-mensual-${today()}.csv`);
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
    '<?xml version="1.0" encoding="UTF-8"?>',
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

  downloadFile(xml, `str-reporte-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function today(): string {
  return todayISO();
}

// ─── Inventory Export ─────────────────────────────────────────────────────────

export interface InventoryExportColumn {
  key: string;
  label: string;
  group: string;
}

export const INVENTORY_COLUMN_GROUPS: {
  id: string;
  label: string;
  columns: InventoryExportColumn[];
}[] = [
  {
    id: 'basic',
    label: 'Información básica',
    columns: [
      { key: 'name',        label: 'Nombre',      group: 'basic' },
      { key: 'property',    label: 'Propiedad',   group: 'basic' },
      { key: 'category',    label: 'Categoría',   group: 'basic' },
      { key: 'description', label: 'Descripción', group: 'basic' },
      { key: 'location',    label: 'Ubicación',   group: 'basic' },
      { key: 'status',      label: 'Estado',      group: 'basic' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock & Control',
    columns: [
      { key: 'quantity',      label: 'Cantidad',        group: 'stock' },
      { key: 'unit',          label: 'Unidad',          group: 'stock' },
      { key: 'is_consumable', label: '¿Es consumible?', group: 'stock' },
      { key: 'min_stock',     label: 'Stock mínimo',    group: 'stock' },
    ],
  },
  {
    id: 'value',
    label: 'Valor & Compra',
    columns: [
      { key: 'purchase_date',             label: 'Fecha de compra',   group: 'value' },
      { key: 'purchase_price',            label: 'Precio de compra',  group: 'value' },
      { key: 'expected_lifetime_months',  label: 'Vida útil (meses)', group: 'value' },
    ],
  },
  {
    id: 'meta',
    label: 'Notas & Fechas',
    columns: [
      { key: 'notes',      label: 'Notas',                group: 'meta' },
      { key: 'created_at', label: 'Fecha de registro',    group: 'meta' },
      { key: 'updated_at', label: 'Última actualización', group: 'meta' },
    ],
  },
];

export const DEFAULT_INVENTORY_COLUMNS = new Set([
  'name', 'property', 'category', 'description', 'location', 'status', 'quantity', 'unit',
]);

type InventoryResolvers = {
  getPropertyName: (id: string) => string;
  getCategoryName: (id: string) => string;
  getStatusLabel:  (status: string) => string;
};

function resolveInventoryCell(
  item: InventoryItemRow,
  key: string,
  r: InventoryResolvers,
): string | number {
  switch (key) {
    case 'name':         return item.name;
    case 'property':     return r.getPropertyName(item.property_id);
    case 'category':     return item.category_id ? r.getCategoryName(item.category_id) : '';
    case 'description':  return item.description ?? '';
    case 'location':     return item.location ?? '';
    case 'status':       return r.getStatusLabel(item.status);
    case 'quantity':     return Number(item.quantity);
    case 'unit':         return item.unit ?? '';
    case 'is_consumable': return item.is_consumable ? 'Sí' : 'No';
    case 'min_stock':    return item.min_stock != null ? Number(item.min_stock) : '';
    case 'purchase_date':  return item.purchase_date ?? '';
    case 'purchase_price': return item.purchase_price != null ? Number(item.purchase_price) : '';
    case 'expected_lifetime_months':
      return item.expected_lifetime_months != null ? item.expected_lifetime_months : '';
    case 'notes':        return item.notes ?? '';
    case 'created_at':   return item.created_at ? item.created_at.slice(0, 10) : '';
    case 'updated_at':   return item.updated_at ? item.updated_at.slice(0, 10) : '';
    default:             return '';
  }
}

/** CSV con BOM UTF-8 para que Excel abra correctamente tildes y eñes. */
function downloadUtf8Csv(content: string, filename: string) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportInventoryToCsv(
  items: InventoryItemRow[],
  columns: InventoryExportColumn[],
  resolvers: InventoryResolvers,
) {
  const header = toCsvRow(columns.map(c => c.label));
  const rows = items.map(item =>
    toCsvRow(columns.map(col => resolveInventoryCell(item, col.key, resolvers))),
  );
  downloadUtf8Csv([header, ...rows].join('\n'), `inventario-${today()}.csv`);
}

export function exportInventoryToExcel(
  items: InventoryItemRow[],
  columns: InventoryExportColumn[],
  resolvers: InventoryResolvers,
) {
  const headerRow = columns.map(c => c.label);
  const dataRows  = items.map(item =>
    columns.map(col => resolveInventoryCell(item, col.key, resolvers)),
  );

  // Re-build SpreadsheetML with explicit UTF-8 declaration
  const tableRows = [headerRow, ...dataRows].map(row => {
    const cells = row.map(cell => {
      if (cell === null || cell === undefined || cell === '')
        return '<Cell><Data ss:Type="String"></Data></Cell>';
      const isNum = typeof cell === 'number';
      return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(String(cell))}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `<Worksheet ss:Name="Inventario"><Table>${tableRows}</Table></Worksheet>`,
    '</Workbook>',
  ].join('');

  downloadFile(xml, `inventario-${today()}.xls`, 'application/vnd.ms-excel');
}
