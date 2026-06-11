import { formatCurrency } from '@/lib/utils';
import { todayISO, formatDateDisplay } from '@/lib/dateUtils';
import { addMoney, subMoney } from '@/lib/money';
import type { FinancialKPIs, MonthlyPnL, ChannelBreakdownRow } from './financial';
import type { InventoryItemRow } from '@/types/database';
import type { Expense } from '@/types';
import { flattenExpensesForExport } from '@/lib/expenseGrouping';

/** Suma money-safe (centavos enteros) — evita drift de coma flotante de JS. */
const sumM = (vals: Array<number | null | undefined>): number =>
  vals.reduce<number>((s, v) => addMoney(s, v ?? 0), 0);

// ─── Booking Export Row ───────────────────────────────────────────────────────

export interface BookingExportRow {
  confirmation_code: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  revenue: number;
  net_payout: number | null;
  status: string;
  channel: string | null;
  property_name: string | null;
  /** Fee cobrado por el canal (Airbnb, Booking…). null = no registrado */
  channel_fees: number | null;
  /** Net of adjustments (damages, extras, discounts). null = not included */
  net_adjustment: number | null;
}

const isCancelledRow = (b: { status: string }) => b.status.toLowerCase().includes('cancel');

const BOOKING_STATUS_LABEL = (b: { status: string; check_in: string; check_out: string }): string => {
  if (b.status.toLowerCase().includes('cancel')) return 'Cancelada';
  const t = todayISO();
  if (b.check_in && b.check_in > t) return 'Reservada';
  if (b.check_in && b.check_out && b.check_in <= t && t < b.check_out) return 'En curso';
  if (b.check_out && b.check_out <= t) return 'Completada';
  return 'Reservada';
};

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

/**
 * Filas de KPIs con desglose completo para que cada métrica sea reproducible:
 *  - Ingreso Bruto = Hospedaje + Cancelaciones cobradas + Ajustes netos
 *  - ADR    = Hospedaje ÷ Noches reservadas
 *  - RevPAR = Hospedaje ÷ Noches disponibles
 *  - Utilidad Neta = Ingreso Bruto − Total Gastos
 */
type KpiRowKind = 'money' | 'pct' | 'int' | 'text';

function buildKpiRows(kpis: FinancialKPIs, period: string): [string, string | number, KpiRowKind][] {
  // Ingresos por hospedaje: base de ADR/RevPAR (solo tarifa de reservas activas)
  const lodgingRevenue = subMoney(subMoney(kpis.grossRevenue, kpis.netAdjustmentIncome), kpis.cancelledRevenue);
  return [
    ['Período', period, 'text'],
    ['— INGRESOS —', '', 'text'],
    ['Ingresos por Hospedaje (base ADR/RevPAR)', lodgingRevenue, 'money'],
    ['(+) Ingresos por Cancelación Cobrada',     kpis.cancelledRevenue, 'money'],
    ['(+) Ajustes Netos (daños, extras, descuentos)', kpis.netAdjustmentIncome, 'money'],
    ['(=) Ingreso Bruto',                        kpis.grossRevenue, 'money'],
    ['Fees de Canal (informativo — no se resta de la utilidad)', kpis.totalChannelFees, 'money'],
    ['— GASTOS —', '', 'text'],
    ['Gastos Fijos',        kpis.totalFixedExpenses, 'money'],
    ['Gastos Variables (incluye multas de cancelación)', kpis.totalVariableExpenses, 'money'],
    ['  de las cuales: Multas por Cancelación', kpis.cancelledFines, 'money'],
    ['(=) Total Gastos',    kpis.totalExpenses, 'money'],
    ['— RESULTADOS —', '', 'text'],
    ['Margen Contribución (Ingreso Bruto − Gastos Variables)', kpis.contributionMargin, 'money'],
    ['Utilidad Neta (Ingreso Bruto − Total Gastos)',           kpis.netProfit, 'money'],
    ['— OPERACIÓN —', '', 'text'],
    ['Ocupación %',          +(kpis.occupancyRate * 100).toFixed(1), 'pct'],
    ['ADR (Hospedaje ÷ Noches Reservadas)',     kpis.adr, 'money'],
    ['RevPAR (Hospedaje ÷ Noches Disponibles)', kpis.revpar, 'money'],
    ['Noches Reservadas',    kpis.totalNights, 'int'],
    ['Noches Disponibles',   kpis.availableNights, 'int'],
    ['Propiedades',          kpis.propertyCount, 'int'],
    ['Break-even Noches',    kpis.breakEvenNights, 'int'],
    ['Break-even Ocu. %',    kpis.breakEvenOccupancy, 'pct'],
    ['Total Reservas',       kpis.totalBookings, 'int'],
    ['Canceladas',           kpis.cancelledCount, 'int'],
    ['', '', 'text'],
    ['Nota', 'ADR y RevPAR usan solo los Ingresos por Hospedaje (sin ajustes ni cancelaciones). Valores redondeados al peso: ADR × noches puede diferir en pocos pesos.', 'text'],
  ];
}

export function exportKpisToCsv(kpis: FinancialKPIs, period: string) {
  const rows = [
    toCsvRow(['Métrica', 'Valor']),
    ...buildKpiRows(kpis, period).map(([label, value]) => toCsvRow([label, value])),
  ];
  downloadUtf8Csv(rows.join('\n'), `str-kpis-${today()}.csv`);
}

// ─── Channel breakdown rows (shared CSV/Excel) ───────────────────────────────

const CHANNEL_HEADER = [
  'Canal', 'Reservas', 'Noches', 'Ingreso Bruto', 'Fees Canal',
  'Neto (tras fees)', 'Gastos de Reservas', 'Utilidad Bruta', 'Utilidad Neta',
];

function buildChannelRows(channels: ChannelBreakdownRow[]): (string | number)[][] {
  const dataRows: (string | number)[][] = channels.map(c => [
    c.channel, c.bookings, c.nights, c.grossRevenue, c.channelFees,
    c.netPayout, c.bookingExpenses, c.grossProfit, c.netProfit,
  ]);
  const total: (string | number)[] = [
    'TOTAL',
    channels.reduce((s, c) => s + c.bookings, 0),
    channels.reduce((s, c) => s + c.nights, 0),
    sumM(channels.map(c => c.grossRevenue)),
    sumM(channels.map(c => c.channelFees)),
    sumM(channels.map(c => c.netPayout)),
    sumM(channels.map(c => c.bookingExpenses)),
    sumM(channels.map(c => c.grossProfit)),
    sumM(channels.map(c => c.netProfit)),
  ];
  return [CHANNEL_HEADER, ...dataRows, total];
}

export function exportMonthlyToCsv(data: MonthlyPnL[], bookings?: BookingExportRow[], channels?: ChannelBreakdownRow[]) {
  const totNights = data.reduce((s, d) => s + d.nights, 0);
  const totAvail  = data.reduce((s, d) => s + d.availableNights, 0);
  const rows = [
    toCsvRow(['Mes', 'Ingresos', 'Gastos', 'Utilidad Neta', 'Noches', 'Noches Disp.', 'Ocupación %']),
    ...data.map(d =>
      toCsvRow([d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.availableNights, d.occupancy])
    ),
    toCsvRow([
      'TOTAL',
      sumM(data.map(d => d.revenue)),
      sumM(data.map(d => d.expenses)),
      sumM(data.map(d => d.netProfit)),
      totNights,
      totAvail,
      totAvail > 0 ? +((totNights / totAvail) * 100).toFixed(1) : 0,
    ]),
  ];

  if (channels && channels.length > 0) {
    rows.push('');
    rows.push(toCsvRow(['--- DESGLOSE POR CANAL ---']));
    for (const r of buildChannelRows(channels)) rows.push(toCsvRow(r));
  }

  if (bookings && bookings.length > 0) {
    const hasAdj = bookings.some(b => b.net_adjustment !== null);
    rows.push('');
    rows.push(toCsvRow(['--- DETALLE DE RESERVAS ---']));
    const header = [
      'Código', 'Huésped', 'Check-in', 'Check-out', 'Noches',
      'Ingresos', 'Fee Canal', 'Neto Pago', 'Estado', 'Canal', 'Propiedad',
      ...(hasAdj ? ['Ajustes Neto'] : []),
    ];
    rows.push(toCsvRow(header));
    for (const b of bookings) {
      rows.push(toCsvRow([
        b.confirmation_code,
        b.guest_name ?? '',
        formatDateDisplay(b.check_in),
        formatDateDisplay(b.check_out),
        b.nights,
        b.revenue,
        b.channel_fees ?? '',
        b.net_payout ?? '',
        BOOKING_STATUS_LABEL(b),
        b.channel ?? '',
        b.property_name ?? '',
        ...(hasAdj ? [b.net_adjustment ?? 0] : []),
      ]));
    }
    // Totales (solo reservas activas — las canceladas no suman ingresos/noches)
    const active  = bookings.filter(b => !isCancelledRow(b));
    const withNet = active.filter(b => b.net_payout != null);
    rows.push(toCsvRow([
      `TOTAL (${active.length} activas)`,
      '', '', '',
      active.reduce((s, b) => s + b.nights, 0),
      sumM(active.map(b => b.revenue)),
      sumM(active.map(b => b.channel_fees ?? 0)),
      sumM(withNet.map(b => b.net_payout)),
      '', '', '',
      ...(hasAdj ? [sumM(active.map(b => b.net_adjustment ?? 0))] : []),
    ]));
    rows.push(toCsvRow([`Nota: Neto Pago total suma solo las ${withNet.length} reservas con neto registrado.`]));
  }

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

export function exportToExcel(kpis: FinancialKPIs, monthly: MonthlyPnL[], period: string, bookings?: BookingExportRow[], channels?: ChannelBreakdownRow[]) {
  const kpiRows: (string | number)[][] = [
    ['Métrica', 'Valor', 'Formato'],
    ...buildKpiRows(kpis, period).map(([label, value, kind]): (string | number)[] => [
      label,
      value,
      kind === 'money' && typeof value === 'number' ? formatCurrency(value)
        : kind === 'pct' && typeof value === 'number' ? `${value}%`
        : '',
    ]),
  ];

  const totNights = monthly.reduce((s, d) => s + d.nights, 0);
  const totAvail  = monthly.reduce((s, d) => s + d.availableNights, 0);
  const monthRows: (string | number)[][] = [
    ['Mes', 'Ingresos (COP)', 'Gastos (COP)', 'Utilidad Neta (COP)', 'Noches', 'Noches Disp.', 'Ocupación %'],
    ...monthly.map(d => [d.month, d.revenue, d.expenses, d.netProfit, d.nights, d.availableNights, d.occupancy]),
    [
      'TOTAL',
      sumM(monthly.map(d => d.revenue)),
      sumM(monthly.map(d => d.expenses)),
      sumM(monthly.map(d => d.netProfit)),
      totNights,
      totAvail,
      totAvail > 0 ? +((totNights / totAvail) * 100).toFixed(1) : 0,
    ],
  ];

  const sheets: Array<{ name: string; rows: (string | number | null | undefined)[][] }> = [];

  if (bookings && bookings.length > 0) {
    const hasAdj = bookings.some(b => b.net_adjustment !== null);
    const bookingHeader = [
      'Código', 'Huésped', 'Check-in', 'Check-out', 'Noches',
      'Ingresos (COP)', 'Fee Canal (COP)', 'Neto Pago (COP)', 'Estado', 'Canal', 'Propiedad',
      ...(hasAdj ? ['Ajustes Neto (COP)'] : []),
    ];
    const bookingDataRows: (string | number | null)[][] = bookings.map(b => [
      b.confirmation_code,
      b.guest_name ?? '',
      formatDateDisplay(b.check_in),
      formatDateDisplay(b.check_out),
      b.nights,
      b.revenue,
      b.channel_fees ?? null,
      b.net_payout ?? null,
      BOOKING_STATUS_LABEL(b),
      b.channel ?? '',
      b.property_name ?? '',
      ...(hasAdj ? [b.net_adjustment ?? 0] : []),
    ]);
    const active  = bookings.filter(b => !isCancelledRow(b));
    const withNet = active.filter(b => b.net_payout != null);
    const totalRow: (string | number)[] = [
      `TOTAL (${active.length} activas)`, '', '', '',
      active.reduce((s, b) => s + b.nights, 0),
      sumM(active.map(b => b.revenue)),
      sumM(active.map(b => b.channel_fees ?? 0)),
      sumM(withNet.map(b => b.net_payout)),
      '', '', '',
      ...(hasAdj ? [sumM(active.map(b => b.net_adjustment ?? 0))] : []),
    ];
    const noteRow = [`Nota: totales solo de reservas activas. Neto Pago suma las ${withNet.length} reservas con neto registrado.`];
    sheets.push({ name: 'Reservas', rows: [bookingHeader, ...bookingDataRows, totalRow, noteRow] });
  }

  if (channels && channels.length > 0) {
    sheets.push({
      name: 'Por Canal',
      rows: [
        ...buildChannelRows(channels),
        [''],
        ['Utilidad Bruta = Ingreso Bruto − Gastos de Reservas · Utilidad Neta = Neto (tras fees) − Gastos de Reservas'],
      ],
    });
  }

  sheets.push({ name: 'P&L Mensual', rows: monthRows });
  sheets.push({ name: 'KPIs',        rows: kpiRows });

  const xml = buildSpreadsheetML(sheets);
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
    case 'purchase_date':  return item.purchase_date ? formatDateDisplay(item.purchase_date) : '';
    case 'purchase_price': return item.purchase_price != null ? Number(item.purchase_price) : '';
    case 'expected_lifetime_months':
      return item.expected_lifetime_months != null ? item.expected_lifetime_months : '';
    case 'notes':        return item.notes ?? '';
    case 'created_at':   return item.created_at ? formatDateDisplay(item.created_at.slice(0, 10)) : '';
    case 'updated_at':   return item.updated_at ? formatDateDisplay(item.updated_at.slice(0, 10)) : '';
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

/** Convert ISO date YYYY-MM-DD to DD-MM-YYYY for display in exports. */
function fmtAseoDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, day] = iso.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
}

export function exportAseoToCsv(rows: AseoExportRow[], periodLabel: string) {
  const header = toCsvRow(['Personal', 'Fecha aseo', 'Código reserva', 'Cliente', 'Propiedad', 'Valor', 'Estado', 'Fecha liquidado']);
  const dataRows = rows.map(r => toCsvRow([
    r.cleaner_name,
    fmtAseoDate(r.done_date),
    r.booking_code ?? '',
    r.guest_name ?? '',
    r.property_name ?? '',
    r.fee,
    ASEO_STATUS_LABEL[r.status] ?? r.status,
    fmtAseoDate(r.paid_date),
  ]));
  downloadUtf8Csv([header, ...dataRows].join('\n'), `historial-aseo-${periodLabel}-${today()}.csv`);
}

export function exportAseoToExcel(rows: AseoExportRow[], periodLabel: string) {
  const headerRow = ['Personal', 'Fecha aseo', 'Código reserva', 'Cliente', 'Propiedad', 'Valor', 'Estado', 'Fecha liquidado'];
  const dataRows: (string | number)[][] = rows.map(r => [
    r.cleaner_name,
    fmtAseoDate(r.done_date),
    r.booking_code ?? '',
    r.guest_name ?? '',
    r.property_name ?? '',
    r.fee,
    ASEO_STATUS_LABEL[r.status] ?? r.status,
    fmtAseoDate(r.paid_date),
  ]);
  const xml = buildSpreadsheetML([
    { name: 'Historial Aseo', rows: [headerRow, ...dataRows] },
  ]);
  downloadFile(xml, `historial-aseo-${periodLabel}-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

export function exportAseoToPdf(rows: AseoExportRow[], periodLabel: string) {
  const total = sumM(rows.map(r => r.fee));
  const tableRows = rows.map(r => `
    <tr>
      <td>${escXml(r.cleaner_name)}</td>
      <td class="date">${fmtAseoDate(r.done_date) || '—'}</td>
      <td>${r.booking_code ?? '—'}</td>
      <td>${escXml(r.guest_name ?? '—')}</td>
      <td>${escXml(r.property_name ?? '—')}</td>
      <td class="num">${formatCurrency(r.fee)}</td>
      <td>${ASEO_STATUS_LABEL[r.status] ?? r.status}</td>
      <td class="date">${fmtAseoDate(r.paid_date) || '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Historial de Aseo — ${escXml(periodLabel)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 11px; color: #1e293b; padding: 24px; }
    h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase;
         letter-spacing: .05em; padding: 7px 6px; text-align: left; border-bottom: 2px solid #e2e8f0; }
    td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.date { white-space: nowrap; }
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
        <th>Personal</th><th>Fecha aseo</th><th>Código reserva</th>
        <th>Cliente</th><th>Propiedad</th>
        <th>Valor</th><th>Estado</th><th>Fecha liquidado</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">Total</td>
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

// ─── Bookings Standalone Export ───────────────────────────────────────────────

export function exportBookingsToCsv(rows: BookingExportRow[], title: string) {
  const header = toCsvRow([
    'Código', 'Canal', 'Estado', 'Propiedad', 'Huéspedes',
    'Check in', 'Check out', 'Noches', 'Ingresos', 'Neto',
  ]);
  const dataRows = rows.map(b => toCsvRow([
    b.confirmation_code,
    b.channel ?? '',
    BOOKING_STATUS_LABEL(b),
    b.property_name ?? '',
    b.guest_name ?? '',
    formatDateDisplay(b.check_in),
    formatDateDisplay(b.check_out),
    b.nights,
    b.revenue,
    b.net_payout ?? '',
  ]));
  const active  = rows.filter(b => !isCancelledRow(b));
  const withNet = active.filter(b => b.net_payout != null);
  const totalRow = toCsvRow([
    `TOTAL (${active.length} activas)`, '', '', '', '', '', '',
    active.reduce((s, b) => s + b.nights, 0),
    sumM(active.map(b => b.revenue)),
    sumM(withNet.map(b => b.net_payout)),
  ]);
  downloadUtf8Csv([header, ...dataRows, totalRow].join('\n'), `reservas-${title}-${today()}.csv`);
}

export function exportBookingsToExcel(rows: BookingExportRow[], title: string) {
  const headerRow = [
    'Código', 'Canal', 'Estado', 'Propiedad', 'Huéspedes',
    'Check in', 'Check out', 'Noches', 'Ingresos (COP)', 'Neto (COP)',
  ];
  const dataRows: (string | number | null)[][] = rows.map(b => [
    b.confirmation_code,
    b.channel ?? '',
    BOOKING_STATUS_LABEL(b),
    b.property_name ?? '',
    b.guest_name ?? '',
    formatDateDisplay(b.check_in),
    formatDateDisplay(b.check_out),
    b.nights,
    b.revenue,
    b.net_payout ?? null,
  ]);
  // Totales solo de reservas activas — las canceladas no aportan ingresos ni noches
  const active       = rows.filter(b => !isCancelledRow(b));
  const withNet      = active.filter(b => b.net_payout != null);
  const totalRevenue = sumM(active.map(b => b.revenue));
  const totalNights  = active.reduce((s, b) => s + b.nights, 0);
  const summaryRows: (string | number)[][] = [
    ['Resumen', ''],
    ['Total reservas',           rows.length],
    ['Reservas activas',         active.length],
    ['Canceladas',               rows.length - active.length],
    ['Total ingresos (activas)', totalRevenue],
    ['Total fees de canal (activas)', sumM(active.map(b => b.channel_fees ?? 0))],
    [`Total neto pago (${withNet.length} reservas con neto registrado)`, sumM(withNet.map(b => b.net_payout))],
    ['Total noches (activas)',   totalNights],
    ['Ingreso promedio por noche', totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0],
  ];
  const xml = buildSpreadsheetML([
    { name: 'Reservas',  rows: [headerRow, ...dataRows] },
    { name: 'Resumen',   rows: summaryRows },
  ]);
  downloadFile(xml, `reservas-${title}-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

// ─── Occupancy Calendar HTML ─────────────────────────────────────────────────

const CAL_PALETTE = [
  { bg: '#dbeafe', color: '#1e40af', dot: '#2563eb', border: '#93c5fd' },
  { bg: '#d1fae5', color: '#065f46', dot: '#059669', border: '#6ee7b7' },
  { bg: '#ede9fe', color: '#4c1d95', dot: '#7c3aed', border: '#c4b5fd' },
  { bg: '#fef3c7', color: '#78350f', dot: '#d97706', border: '#fcd34d' },
  { bg: '#ccfbf1', color: '#134e4a', dot: '#0d9488', border: '#5eead4' },
  { bg: '#ffe4e6', color: '#9f1239', dot: '#e11d48', border: '#fda4af' },
  { bg: '#e0e7ff', color: '#312e81', dot: '#4f46e5', border: '#a5b4fc' },
  { bg: '#fce7f3', color: '#831843', dot: '#db2777', border: '#f9a8d4' },
];
const CAL_CANCELLED = { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1', border: '#e2e8f0' };
const CAL_DOW       = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const CAL_MONTHS    = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const LABEL_W       = 160; // px

function buildOccupancyCalendarHtml(
  rows: BookingExportRow[],
  periodFrom?: string,
  periodTo?:   string,
): string {
  if (rows.length === 0 && !periodFrom) return '';

  const pad2   = (n: number) => String(n).padStart(2, '0');
  const isoDay = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
  const isCancelled = (b: BookingExportRow) => b.status.toLowerCase().includes('cancel');

  // Assign a stable color per property name
  const propColorMap = new Map<string, number>();
  let ci = 0;
  for (const b of rows) {
    const key = b.property_name ?? '';
    if (!propColorMap.has(key)) propColorMap.set(key, ci++ % CAL_PALETTE.length);
  }

  // Determine months to render
  const months: { year: number; month: number }[] = [];
  if (periodFrom && periodTo) {
    const cur = new Date(periodFrom + 'T12:00:00');
    const end = new Date(periodTo   + 'T12:00:00');
    while (cur <= end) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else {
    const seen = new Set<string>();
    for (const b of rows) {
      const d = new Date(b.check_in + 'T12:00:00');
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      if (!seen.has(key)) { seen.add(key); months.push({ year: d.getFullYear(), month: d.getMonth() + 1 }); }
    }
    months.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }
  if (months.length === 0) return '';

  // Property legend
  const propEntries = Array.from(propColorMap.entries());
  let legendHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">
    <span style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Propiedades:</span>`;
  for (const [name, colorIdx] of propEntries) {
    const c = CAL_PALETTE[colorIdx % CAL_PALETTE.length];
    legendHtml += `<div style="display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:${c.bg};color:${c.color};border:1.5px solid ${c.border};font-size:10px;font-weight:700">
      <span style="width:8px;height:8px;border-radius:50%;background:${c.dot};display:inline-block;flex-shrink:0"></span>
      ${escXml(name || 'Sin propiedad')}
    </div>`;
  }
  const cancelledCount = rows.filter(b => isCancelled(b)).length;
  if (cancelledCount > 0) {
    legendHtml += `<div style="display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:${CAL_CANCELLED.bg};color:${CAL_CANCELLED.color};border:1.5px solid ${CAL_CANCELLED.border};font-size:10px;font-weight:600">
      <span style="width:8px;height:8px;border-radius:50%;background:${CAL_CANCELLED.dot};display:inline-block;flex-shrink:0"></span>
      ${cancelledCount} cancelada${cancelledCount !== 1 ? 's' : ''}
    </div>`;
  }
  legendHtml += '</div>';

  let html = legendHtml;

  for (const { year, month } of months) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const mStart = new Date(year, month - 1, 1);
    const mEnd   = new Date(year, month,     0);

    // Bookings that overlap with this month
    const monthBookings = rows.filter(b => {
      const st = new Date(b.check_in  + 'T12:00:00');
      const en = new Date(b.check_out + 'T12:00:00');
      return st <= mEnd && en >= mStart;
    });

    const sorted = [...monthBookings].sort((a, b) => {
      if (isCancelled(a) !== isCancelled(b)) return isCancelled(a) ? 1 : -1;
      return a.check_in.localeCompare(b.check_in);
    });

    const activeCount = sorted.filter(b => !isCancelled(b)).length;

    // Day-header cells
    let dayHeaders = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dow  = new Date(year, month - 1, d).getDay();
      const isWe = dow === 0 || dow === 6;
      dayHeaders += `<th style="text-align:center;padding:3px 0;border-right:${d < daysInMonth ? '1px solid #e8edf2' : 'none'};background:${isWe ? '#f1f5f9' : 'transparent'};font-weight:normal;min-width:0">
        <div style="font-size:9px;font-weight:700;color:${isWe ? '#94a3b8' : '#374151'};line-height:1">${d}</div>
        <div style="font-size:7px;color:#cbd5e1;line-height:1;margin-top:1px">${CAL_DOW[dow]}</div>
      </th>`;
    }

    // Booking rows
    let bodyRows = '';
    if (sorted.length === 0) {
      bodyRows = `<tr><td colspan="${daysInMonth + 1}" style="padding:14px 16px;text-align:center;color:#94a3b8;font-size:10px">Sin reservas este mes</td></tr>`;
    } else {
      for (let ri = 0; ri < sorted.length; ri++) {
        const bk        = sorted[ri];
        const cancelled = isCancelled(bk);
        const colorIdx  = propColorMap.get(bk.property_name ?? '') ?? 0;
        const p         = cancelled ? CAL_CANCELLED : CAL_PALETTE[colorIdx % CAL_PALETTE.length];
        const isLast    = ri === sorted.length - 1;

        const labelCell = `<td style="padding:4px 8px;background:${cancelled ? '#f8fafc' : p.bg};border-right:3px solid ${p.dot};vertical-align:middle;opacity:${cancelled ? 0.6 : 1};width:${LABEL_W}px">
          <div style="font-size:10px;font-weight:700;color:${p.color};line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:${cancelled ? 'line-through' : 'none'}">${escXml(bk.guest_name ?? '—')}</div>
          ${bk.property_name ? `<div style="font-size:8px;font-weight:600;color:${p.dot};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:${p.dot};flex-shrink:0;display:inline-block"></span>${escXml(bk.property_name)}</div>` : ''}
          <div style="font-size:8px;font-family:monospace;color:${p.color};opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1">${cancelled ? '✕ ' : ''}${escXml(bk.confirmation_code)}${!cancelled && bk.nights > 0 ? ` · ${bk.nights}n` : ''}</div>
          ${!cancelled && bk.revenue > 0 ? `<div style="font-size:9px;font-weight:800;color:${p.dot};line-height:1">${formatCurrency(bk.revenue)}</div>` : ''}
        </td>`;

        let dayCells = '';
        for (let d = 1; d <= daysInMonth; d++) {
          const iso        = isoDay(year, month, d);
          const nextIso    = isoDay(year, month, d + 1);
          const inStay     = iso >= bk.check_in && iso < bk.check_out;
          const isCheckIn  = iso === bk.check_in;
          const isLastOcc  = inStay && nextIso === bk.check_out;
          const isCODay    = iso === bk.check_out;
          const dow        = new Date(year, month - 1, d).getDay();
          const isWe       = dow === 0 || dow === 6;

          if (!inStay) {
            dayCells += `<td style="background:${isWe ? '#f8fafc' : 'white'};border-right:${d < daysInMonth ? '1px solid #f1f5f9' : 'none'};border-left:${isCODay ? `2px solid ${p.dot}33` : 'none'}"></td>`;
          } else {
            dayCells += `<td style="background:${cancelled ? p.bg + 'aa' : p.bg};border-right:${d < daysInMonth ? `1px solid ${p.border}44` : 'none'};border-left:${isCheckIn ? `3px solid ${p.dot}` : 'none'};position:relative">
              ${isCheckIn ? `<div style="width:5px;height:5px;border-radius:50%;background:${p.dot};margin:3px auto 0"></div>` : ''}
              ${isLastOcc ? `<div style="width:4px;height:4px;border-radius:50%;background:${p.dot};opacity:0.55;position:absolute;bottom:3px;right:3px"></div>` : ''}
            </td>`;
          }
        }

        bodyRows += `<tr style="border-bottom:${isLast ? 'none' : '1px solid #f1f5f9'};height:36px">${labelCell}${dayCells}</tr>`;
      }
    }

    html += `
    <div style="border:1.5px solid #cbd5e1;border-radius:12px;margin-bottom:16px;overflow:visible">
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:white;padding:9px 14px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:10px;border-radius:10px 10px 0 0">
        ${CAL_MONTHS[month - 1]} ${year}
        <span style="font-size:10px;font-weight:400;opacity:0.75;margin-left:auto">${activeCount} reserva${activeCount !== 1 ? 's' : ''} activa${activeCount !== 1 ? 's' : ''}</span>
      </div>
      <table class="month-cal" style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup>
          <col style="width:${LABEL_W}px">
          ${Array.from({ length: daysInMonth }, () => '<col>').join('')}
        </colgroup>
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="padding:5px 8px;font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;border-right:2px solid #e2e8f0;text-align:left;vertical-align:middle">Huésped · Propiedad</th>
            ${dayHeaders}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  return html;
}

export function exportBookingsToPdf(rows: BookingExportRow[], title: string, opts: { periodFrom?: string; periodTo?: string; includeCalendar?: boolean } = {}) {
  const { includeCalendar = true } = opts;
  // Totales solo de reservas activas — las canceladas no aportan ingresos ni noches
  const active       = rows.filter(b => !isCancelledRow(b));
  const withNet      = active.filter(b => b.net_payout != null);
  const totalRevenue = sumM(active.map(b => b.revenue));
  const totalNights  = active.reduce((s, b) => s + b.nights, 0);
  const totalFees    = sumM(active.map(b => b.channel_fees ?? 0));
  const totalNet     = sumM(withNet.map(b => b.net_payout));

  const tableRows = rows.map(b => `
    <tr>
      <td><code>${escXml(b.confirmation_code)}</code></td>
      <td>${escXml(b.channel ?? '—')}</td>
      <td><span class="chip">${escXml(BOOKING_STATUS_LABEL(b))}</span></td>
      <td>${escXml(b.property_name ?? '—')}</td>
      <td>${escXml(b.guest_name ?? '—')}</td>
      <td>${formatDateDisplay(b.check_in)}</td>
      <td>${formatDateDisplay(b.check_out)}</td>
      <td class="num">${b.nights}</td>
      <td class="num">${formatCurrency(b.revenue)}</td>
      <td class="num">${b.net_payout != null ? formatCurrency(b.net_payout) : '—'}</td>
    </tr>`).join('');

  const calendarSection = includeCalendar
    ? `<h2 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px;margin-top:20px;letter-spacing:-0.01em">
    🗓️ Calendario de Ocupación
  </h2>
  ${buildOccupancyCalendarHtml(rows, opts.periodFrom, opts.periodTo)}`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reservas — ${escXml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.02em; }
    .sub { font-size: 12px; color: #64748b; margin-bottom: 20px; }
    .summary { display: flex; gap: 24px; margin-bottom: 20px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 18px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; font-weight: 600; }
    .kpi-value { font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; color: #475569; font-size: 10px; text-transform: uppercase;
         letter-spacing: .05em; padding: 8px 6px; text-align: left; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
    td { padding: 6px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    code { font-family: monospace; font-size: 10px; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
    .chip { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: #e2e8f0; color: #475569; white-space: nowrap; }
    tr:nth-child(even) td { background: #fafafa; }
    tfoot td { font-weight: 700; border-top: 2px solid #e2e8f0; padding-top: 10px; background: #f8fafc; }
    @page { size: A4 landscape; margin: 12mm; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
      /* Calendar tables: allow page breaks so thead repeats */
      .month-cal { overflow: visible !important; }
      .month-cal thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()"
    style="position:fixed;top:16px;right:16px;padding:8px 16px;background:#2563eb;color:#fff;
           border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
    🖨️ Imprimir / PDF
  </button>
  <h1>📅 Reservas</h1>
  <p class="sub">Período: ${escXml(title)} — ${rows.length} reserva${rows.length !== 1 ? 's' : ''}</p>
  <div class="summary">
    <div class="kpi">
      <div class="kpi-label">Ingresos (activas)</div>
      <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Fees de canal</div>
      <div class="kpi-value">${formatCurrency(totalFees)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Noches (activas)</div>
      <div class="kpi-value">${totalNights}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Ingreso / noche</div>
      <div class="kpi-value">${totalNights > 0 ? formatCurrency(Math.round(totalRevenue / totalNights)) : '—'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Reservas (activas)</div>
      <div class="kpi-value">${rows.length} (${active.length})</div>
    </div>
  </div>

  <h2 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px;margin-top:8px;letter-spacing:-0.01em">
    📋 Detalle de Reservas
  </h2>
  <table>
    <thead>
      <tr>
        <th>Código</th><th>Canal</th><th>Estado</th><th>Propiedad</th><th>Huéspedes</th>
        <th>Check in</th><th>Check out</th><th>Noches</th>
        <th>Ingresos</th><th>Neto</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="7">Total (${active.length} activas)</td>
        <td class="num">${totalNights}</td>
        <td class="num">${formatCurrency(totalRevenue)}</td>
        <td class="num">${formatCurrency(totalNet)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="font-size:9px;color:#94a3b8;margin-top:6px">
    Totales calculados solo sobre reservas activas (no canceladas).
    El total «Neto pago» suma únicamente las ${withNet.length} reservas con neto registrado.
  </p>
  ${calendarSection}
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ─── Expenses Standalone Export ───────────────────────────────────────────────

const EXPENSE_STATUS_LABEL: Record<string, string> = {
  paid:    'Pagado',
  pending: 'Pendiente',
  partial: 'Parcial',
};

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  fixed:    'Fijo',
  variable: 'Variable',
};

export function exportExpensesToCsv(
  rows: Expense[],
  propMap: Map<string, string>,
  title: string,
) {
  const flat = flattenExpensesForExport(rows);
  const header = toCsvRow(['Fecha', 'Categoría', 'Tipo', 'Descripción', 'Proveedor', 'Propiedad', 'Monto', 'Estado']);
  const dataRows = flat.map(e => toCsvRow([
    e.date,
    e.category,
    EXPENSE_TYPE_LABEL[e.type] ?? e.type,
    e.description ?? '',
    e.vendor ?? '',
    e._isGroupHeader
      ? (e._isSharedBillGroup
          ? `(${e._groupSize} props · pago proveedor)`
          : e._isVirtualVendorGroup
            ? `(${e._groupSize} props · mismo proveedor)`
            : `(${e._groupSize} propiedades)`)
      : (e.property_id ? (propMap.get(e.property_id) ?? '') : 'General'),
    e.amount,
    EXPENSE_STATUS_LABEL[e.status] ?? e.status,
  ]));
  downloadUtf8Csv([header, ...dataRows].join('\n'), `gastos-${title}-${today()}.csv`);
}

export function exportExpensesToExcel(
  rows: Expense[],
  propMap: Map<string, string>,
  title: string,
) {
  const flat = flattenExpensesForExport(rows);
  const headerRow = ['Fecha', 'Categoría', 'Tipo', 'Descripción', 'Proveedor', 'Propiedad', 'Monto (COP)', 'Estado'];
  const dataRows: (string | number | null)[][] = flat.map(e => [
    e.date,
    e.category,
    EXPENSE_TYPE_LABEL[e.type] ?? e.type,
    e.description ?? '',
    e.vendor ?? '',
    e._isGroupHeader
      ? (e._isSharedBillGroup
          ? `(${e._groupSize} props · pago proveedor)`
          : e._isVirtualVendorGroup
            ? `(${e._groupSize} props · mismo proveedor)`
            : `(${e._groupSize} propiedades)`)
      : (e.property_id ? (propMap.get(e.property_id) ?? '') : 'General'),
    e.amount,
    EXPENSE_STATUS_LABEL[e.status] ?? e.status,
  ]);
  const total = sumM(flat.map(e => e.amount));
  const summaryRows: (string | number)[][] = [
    ['Resumen', ''],
    ['Total gastos',   flat.length],
    ['Total monto',    total],
    ['Gastos fijos',   flat.filter(e => e.type === 'fixed').length],
    ['Gastos variables', flat.filter(e => e.type === 'variable').length],
    ['Pendientes',     flat.filter(e => e.status === 'pending').length],
    ['Pagados',        flat.filter(e => e.status === 'paid').length],
  ];
  const xml = buildSpreadsheetML([
    { name: 'Gastos',  rows: [headerRow, ...dataRows] },
    { name: 'Resumen', rows: summaryRows },
  ]);
  downloadFile(xml, `gastos-${title}-${today()}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

export function exportExpensesToPdf(
  rows: Expense[],
  propMap: Map<string, string>,
  title: string,
) {
  const flat = flattenExpensesForExport(rows);
  const total = sumM(flat.map(e => e.amount));
  const pendingTotal = sumM(flat.filter(e => e.status === 'pending').map(e => e.amount));

  const tableRows = flat.map(e => {
    const groupTypeLabel = e._isSharedBillGroup
      ? 'pago a proveedor'
      : e._isVirtualVendorGroup
        ? 'mismo proveedor / mes'
        : 'propiedades';
    const propCell = e._isGroupHeader
      ? `<span style="color:#7c3aed;font-size:10px">⇄ ${e._groupSize} ${groupTypeLabel}</span>`
      : escXml(e.property_id ? (propMap.get(e.property_id) ?? '—') : 'General');

    const mainRow = `
    <tr${e._isGroupHeader ? ' style="background:#f5f3ff"' : ''}>
      <td>${formatDateDisplay(e.date)}</td>
      <td>${escXml(e.category)}</td>
      <td><span class="chip-${e.type}">${EXPENSE_TYPE_LABEL[e.type] ?? e.type}</span></td>
      <td class="desc">${escXml(e.description ?? '—')}</td>
      <td>${escXml(e.vendor ?? '—')}</td>
      <td>${propCell}</td>
      <td class="num">${formatCurrency(e.amount)}</td>
      <td><span class="chip-status-${e.status}">${EXPENSE_STATUS_LABEL[e.status] ?? e.status}</span></td>
    </tr>`;

    // For group headers, add one child row per property (any tier)
    let childRows = '';
    if (e._isGroupHeader && e._members) {
      childRows = e._members.map(m => `
    <tr style="background:#faf5ff">
      <td style="padding-left:20px;color:#94a3b8;font-size:10px">└</td>
      <td colspan="4" style="font-size:10px;color:#7c3aed;padding-left:4px">
        ${escXml(m.property_id ? (propMap.get(m.property_id) ?? m.property_id.slice(0, 8)) : 'General')}
      </td>
      <td style="font-size:10px;color:#7c3aed"></td>
      <td class="num" style="font-size:10px;color:#7c3aed">${formatCurrency(m.amount)}</td>
      <td></td>
    </tr>`).join('');
    }

    return mainRow + childRows;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Gastos — ${escXml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.02em; }
    .sub { font-size: 12px; color: #64748b; margin-bottom: 20px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 18px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; font-weight: 600; }
    .kpi-value { font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 2px; }
    .kpi-value.negative { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; color: #475569; font-size: 10px; text-transform: uppercase;
         letter-spacing: .05em; padding: 8px 6px; text-align: left; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
    td { padding: 6px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.desc { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; }
    .chip-fixed    { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; }
    .chip-variable { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .chip-status-paid    { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #d1fae5; color: #065f46; }
    .chip-status-pending { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #fef3c7; color: #92400e; }
    .chip-status-partial { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #ffedd5; color: #9a3412; }
    tr:nth-child(even) td { background: #fafafa; }
    tfoot td { font-weight: 700; border-top: 2px solid #e2e8f0; padding-top: 10px; background: #f8fafc; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()"
    style="position:fixed;top:16px;right:16px;padding:8px 16px;background:#2563eb;color:#fff;
           border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
    🖨️ Imprimir / PDF
  </button>
  <h1>💸 Gastos</h1>
  <p class="sub">Período: ${escXml(title)} — ${flat.length} gasto${flat.length !== 1 ? 's' : ''}</p>
  <div class="summary">
    <div class="kpi">
      <div class="kpi-label">Total gastos</div>
      <div class="kpi-value negative">${formatCurrency(total)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Pendientes</div>
      <div class="kpi-value" style="font-size:18px;color:#d97706">${formatCurrency(pendingTotal)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">N.º registros</div>
      <div class="kpi-value" style="font-size:18px">${flat.length}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Fecha</th><th>Categoría</th><th>Tipo</th><th>Descripción</th>
        <th>Proveedor</th><th>Propiedad</th><th>Monto</th><th>Estado</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="6">Total</td>
        <td class="num">${formatCurrency(total)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}
