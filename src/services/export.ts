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

export function exportMonthlyToCsv(data: MonthlyPnL[], modeLabel?: string) {
  const modeSlug = modeLabel?.includes('reservas') ? 'por-reservas' : 'por-dias';
  const rows = [
    ...(modeLabel ? [toCsvRow(['Modo de atribución', modeLabel])] : []),
    toCsvRow(['Mes', 'Ingresos', 'Gastos', 'Utilidad Neta', 'Noches', 'Ocupación %']),
    ...data.map(d =>
      toCsvRow([d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.occupancy])
    ),
  ];
  downloadUtf8Csv(rows.join('\n'), `str-pnl-mensual-${modeSlug}-${today()}.csv`);
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

export function exportToExcel(kpis: FinancialKPIs, monthly: MonthlyPnL[], period: string, modeLabel?: string) {
  const kpiRows: (string | number)[][] = [
    ['Métrica', 'Valor', 'Formato'],
    ['Período', period, ''],
    ...(modeLabel ? [['Modo de atribución', modeLabel, '']] : [] as (string | number)[][]),
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

  const modeSlug = modeLabel?.includes('reservas') ? 'por-reservas' : 'por-dias';
  downloadFile(xml, `str-reporte-${modeSlug}-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
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
  {
    id: 'maintenance',
    label: 'Mantenimiento',
    columns: [
      { key: 'maint_status',     label: 'Estado mantenimiento',       group: 'maintenance' },
      { key: 'maint_last_date',  label: 'Último mantenimiento (fecha)', group: 'maintenance' },
      { key: 'maint_last_title', label: 'Último mantenimiento (título)', group: 'maintenance' },
      { key: 'maint_next_date',  label: 'Próximo mantenimiento (fecha)', group: 'maintenance' },
      { key: 'maint_next_title', label: 'Próximo mantenimiento (título)', group: 'maintenance' },
      { key: 'maint_recurring',  label: '¿Recurrente?',               group: 'maintenance' },
    ],
  },
];

export const DEFAULT_INVENTORY_COLUMNS = new Set([
  'name', 'property', 'category', 'description', 'location', 'status', 'quantity', 'unit',
]);

export type InventoryMaintInfo = {
  lastDate:  string;
  lastTitle: string;
  nextDate:  string;
  nextTitle: string;
  isRecurring: boolean;
  statusLabel: string;
};

type InventoryResolvers = {
  getPropertyName: (id: string) => string;
  getCategoryName: (id: string) => string;
  getStatusLabel:  (status: string) => string;
  getMaintInfo?:   (itemId: string) => InventoryMaintInfo;
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
    // ── Maintenance columns ────────────────────────────────────────────────
    case 'maint_status':     return r.getMaintInfo ? r.getMaintInfo(item.id).statusLabel : '';
    case 'maint_last_date':  return r.getMaintInfo ? r.getMaintInfo(item.id).lastDate : '';
    case 'maint_last_title': return r.getMaintInfo ? r.getMaintInfo(item.id).lastTitle : '';
    case 'maint_next_date':  return r.getMaintInfo ? r.getMaintInfo(item.id).nextDate : '';
    case 'maint_next_title': return r.getMaintInfo ? r.getMaintInfo(item.id).nextTitle : '';
    case 'maint_recurring':  return r.getMaintInfo ? (r.getMaintInfo(item.id).isRecurring ? 'Sí' : 'No') : '';
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

// ─── Aseo Export ──────────────────────────────────────────────────────────────

export interface AseoExportRow {
  cleaner_name: string;
  done_date: string | null;
  booking_code: string | null;
  property_name: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  fee: number;
  status: string;
  paid_date: string | null;
}

const ASEO_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  done:    'Hecho',
  paid:    'Liquidado',
};

export function exportAseoToCsv(rows: AseoExportRow[], periodLabel: string) {
  const header = toCsvRow(['Personal', 'Fecha hecho', 'Código reserva', 'Propiedad', 'Huésped', 'Check-in', 'Check-out', 'Valor', 'Estado', 'Fecha liquidado']);
  const dataRows = rows.map(r => toCsvRow([
    r.cleaner_name,
    r.done_date ?? '',
    r.booking_code ?? '',
    r.property_name ?? '',
    r.guest_name ?? '',
    r.check_in ?? '',
    r.check_out ?? '',
    r.fee,
    ASEO_STATUS_LABEL[r.status] ?? r.status,
    r.paid_date ?? '',
  ]));
  downloadUtf8Csv([header, ...dataRows].join('\n'), `historial-aseo-${periodLabel}-${today()}.csv`);
}

export function exportAseoToExcel(rows: AseoExportRow[], periodLabel: string) {
  const headerRow = ['Personal', 'Fecha hecho', 'Código reserva', 'Propiedad', 'Huésped', 'Check-in', 'Check-out', 'Valor', 'Estado', 'Fecha liquidado'];
  const dataRows: (string | number)[][] = rows.map(r => [
    r.cleaner_name,
    r.done_date ?? '',
    r.booking_code ?? '',
    r.property_name ?? '',
    r.guest_name ?? '',
    r.check_in ?? '',
    r.check_out ?? '',
    r.fee,
    ASEO_STATUS_LABEL[r.status] ?? r.status,
    r.paid_date ?? '',
  ]);
  const xml = buildSpreadsheetML([
    { name: 'Historial Aseo', rows: [headerRow, ...dataRows] },
  ]);
  downloadFile(xml, `historial-aseo-${periodLabel}-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

export function exportAseoToPdf(rows: AseoExportRow[], periodLabel: string) {
  const total = rows.reduce((s, r) => s + r.fee, 0);
  const tableRows = rows.map(r => `
    <tr>
      <td>${escXml(r.cleaner_name)}</td>
      <td>${r.done_date ?? '—'}</td>
      <td>${r.booking_code ?? '—'}</td>
      <td>${escXml(r.property_name ?? '—')}</td>
      <td class="num">${formatCurrency(r.fee)}</td>
      <td>${ASEO_STATUS_LABEL[r.status] ?? r.status}</td>
      <td>${r.paid_date ?? '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Historial de Aseo — ${escXml(periodLabel)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
    h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; color: #475569; font-size: 11px; text-transform: uppercase;
         letter-spacing: .05em; padding: 8px; text-align: left; border-bottom: 2px solid #e2e8f0; }
    td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr:nth-child(even) td { background: #f8fafc; }
    tfoot td { font-weight: 700; border-top: 2px solid #e2e8f0; padding-top: 10px; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()"
    style="position:fixed;top:16px;right:16px;padding:8px 16px;background:#2563eb;color:#fff;
           border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
    🖨️ Imprimir / PDF
  </button>
  <h1>🧹 Historial de Aseo</h1>
  <p class="sub">Período: ${escXml(periodLabel)} — ${rows.length} registro${rows.length !== 1 ? 's' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Personal</th><th>Fecha hecho</th><th>Código reserva</th>
        <th>Propiedad</th><th>Valor</th><th>Estado</th><th>Fecha liquidado</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total</td>
        <td class="num">${formatCurrency(total)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}
