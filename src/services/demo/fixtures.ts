// Fixtures coherentes para modo demo.
// Todos los IDs son estables. Las fechas se calculan dinámicamente respecto a `today`
// para que el demo siempre se vea fresco.
//
// Datos:
//  - 7 propiedades en Medellín distribuidas en 3 grupos + etiquetas
//  - 3 cuentas bancarias (2 bancos + efectivo), con actividad en todas
//  - ~75 reservas distribuidas en [-95d, +60d], payouts repartidos entre cuentas
//  - ~80 gastos (fijos mensuales + variables por estadía + mantenimientos)
//  - Vendors, inventarios, mantenimientos, depósitos, credit pool, ajustes
//
// No depende de Supabase. Calculado lazy una sola vez por sesión.
// Total ≈ 250 filas — sin impacto en performance.

import type {
  PropertyRow,
  BookingRow,
  ExpenseRow,
  BankAccountRow,
  VendorRow,
  ListingRow,
  CleanerGroupRow,
  BookingCleaningRow,
  InventoryCategoryRow,
  InventoryItemRow,
  MaintenanceScheduleRow,
  CreditPoolRow,
  AccountDepositRow,
  BookingAdjustmentRow,
  PropertyGroupRow,
  PropertyTagRow,
  PropertyTagAssignmentRow,
  VendorPropertyRow,
  PropertyRecurringExpenseRow,
} from '@/types/database';

const OWNER_ID = 'demo-owner-0000-0000-0000-000000000000';

// ── Helpers de fecha ────────────────────────────────────────────────────────
const today = new Date();
today.setHours(0, 0, 0, 0);

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isoTs = (d: Date): string => d.toISOString();
const offsetIso = (days: number): string => iso(addDays(today, days));
const offsetIsoTs = (days: number): string => isoTs(addDays(today, days));

// PRNG determinístico para reproducibilidad y evitar saltos visuales por re-render.
let seed = 1337;
const rand = (): number => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};
const randInt = (min: number, max: number): number => Math.floor(rand() * (max - min + 1)) + min;

// ── IDs estables ────────────────────────────────────────────────────────────
export const DEMO_IDS = {
  group1: 'demo-grp-poblado',
  group2: 'demo-grp-laureles',
  group3: 'demo-grp-envigado',
  prop1: 'demo-prop-001',
  prop2: 'demo-prop-002',
  prop3: 'demo-prop-003',
  prop4: 'demo-prop-004',
  prop5: 'demo-prop-005',
  prop6: 'demo-prop-006',
  prop7: 'demo-prop-007',
  listing1: 'demo-list-001',
  listing2: 'demo-list-002',
  listing3: 'demo-list-003',
  listing4: 'demo-list-004',
  listing5: 'demo-list-005',
  listing6: 'demo-list-006',
  listing7: 'demo-list-007',
  bank1: 'demo-bank-001',
  bank2: 'demo-bank-002',
  bankCash: 'demo-bank-cash',
  vendorClean: 'demo-vend-001',
  vendorMaint: 'demo-vend-002',
  vendorLaundry: 'demo-vend-003',
  vendorClean2: 'demo-vend-004',
  cleanerGroup: 'demo-cgrp-001',
  inventoryCat1: 'demo-icat-001',
  inventoryCat2: 'demo-icat-002',
  inventoryCat3: 'demo-icat-003',
  inventoryCat4: 'demo-icat-004',
  creditPool: 'demo-pool-001',
  tagPremium: 'demo-tag-premium',
  tagPetFriendly: 'demo-tag-pet',
  tagMetro: 'demo-tag-metro',
  tagVacacional: 'demo-tag-vac',
  tagVistaParque: 'demo-tag-vista',
} as const;

const ALL_PROP_IDS = [
  DEMO_IDS.prop1, DEMO_IDS.prop2, DEMO_IDS.prop3, DEMO_IDS.prop4,
  DEMO_IDS.prop5, DEMO_IDS.prop6, DEMO_IDS.prop7,
];
const ALL_LISTING_IDS = [
  DEMO_IDS.listing1, DEMO_IDS.listing2, DEMO_IDS.listing3, DEMO_IDS.listing4,
  DEMO_IDS.listing5, DEMO_IDS.listing6, DEMO_IDS.listing7,
];

// ── Property groups ─────────────────────────────────────────────────────────
export const DEMO_PROPERTY_GROUPS: PropertyGroupRow[] = [
  { id: DEMO_IDS.group1, owner_id: OWNER_ID, name: 'El Poblado', color: '#3b82f6', sort_order: 0, created_at: offsetIsoTs(-365) },
  { id: DEMO_IDS.group2, owner_id: OWNER_ID, name: 'Laureles',   color: '#10b981', sort_order: 1, created_at: offsetIsoTs(-365) },
  { id: DEMO_IDS.group3, owner_id: OWNER_ID, name: 'Envigado',   color: '#f59e0b', sort_order: 2, created_at: offsetIsoTs(-365) },
];

// ── Property tags ───────────────────────────────────────────────────────────
export const DEMO_PROPERTY_TAGS: PropertyTagRow[] = [
  { id: DEMO_IDS.tagPremium,     owner_id: OWNER_ID, name: 'Premium',         color: '#a855f7', created_at: offsetIsoTs(-300) },
  { id: DEMO_IDS.tagPetFriendly, owner_id: OWNER_ID, name: 'Pet-friendly',    color: '#0ea5e9', created_at: offsetIsoTs(-300) },
  { id: DEMO_IDS.tagMetro,       owner_id: OWNER_ID, name: 'Cerca a metro',   color: '#22c55e', created_at: offsetIsoTs(-300) },
  { id: DEMO_IDS.tagVacacional,  owner_id: OWNER_ID, name: 'Vacacional',      color: '#f97316', created_at: offsetIsoTs(-300) },
  { id: DEMO_IDS.tagVistaParque, owner_id: OWNER_ID, name: 'Vista al parque', color: '#14b8a6', created_at: offsetIsoTs(-300) },
];

// ── Properties ──────────────────────────────────────────────────────────────
type PropSpec = {
  id: string;
  name: string;
  address: string;
  group: string;
  estrato: number;
  bedrooms: number;
  max_guests: number;
  notes: string;
  cleaningFee: number;
  rnt: string;
  baseRate: number;
};

const PROP_SPECS: PropSpec[] = [
  { id: DEMO_IDS.prop1, name: 'Apto El Poblado 204',  address: 'Cra 35 # 7-50, El Poblado, Medellín',  group: DEMO_IDS.group1, estrato: 5, bedrooms: 1, max_guests: 3, notes: 'Vista al parque, balcón, A/C.',     cleaningFee: 60_000, rnt: 'RNT-123456', baseRate: 380_000 },
  { id: DEMO_IDS.prop2, name: 'Apto El Poblado 1102', address: 'Cl 10 # 30-15, El Poblado, Medellín',  group: DEMO_IDS.group1, estrato: 6, bedrooms: 2, max_guests: 5, notes: 'Piso alto, gimnasio, jacuzzi.',    cleaningFee: 90_000, rnt: 'RNT-223344', baseRate: 520_000 },
  { id: DEMO_IDS.prop3, name: 'Suite Laureles 301',   address: 'Cra 70 # 4-25, Laureles, Medellín',    group: DEMO_IDS.group2, estrato: 4, bedrooms: 0, max_guests: 2, notes: 'Estudio remodelado, cocina equipada.', cleaningFee: 50_000, rnt: 'RNT-654321', baseRate: 290_000 },
  { id: DEMO_IDS.prop4, name: 'Loft Laureles 502',    address: 'Cra 73 # 38-10, Laureles, Medellín',   group: DEMO_IDS.group2, estrato: 5, bedrooms: 1, max_guests: 3, notes: 'Loft de diseño, terraza privada.',  cleaningFee: 70_000, rnt: 'RNT-778899', baseRate: 410_000 },
  { id: DEMO_IDS.prop5, name: 'Casa Envigado',        address: 'Cl 25 Sur # 38-90, Envigado',         group: DEMO_IDS.group3, estrato: 5, bedrooms: 3, max_guests: 7, notes: 'Casa con jardín, parqueadero, BBQ.', cleaningFee: 130_000, rnt: 'RNT-998877', baseRate: 720_000 },
  { id: DEMO_IDS.prop6, name: 'Aptaestudio Envigado', address: 'Cl 38 Sur # 43-12, Envigado',         group: DEMO_IDS.group3, estrato: 4, bedrooms: 0, max_guests: 2, notes: 'Aptaestudio cerca al metro Envigado.', cleaningFee: 45_000, rnt: 'RNT-665544', baseRate: 250_000 },
  { id: DEMO_IDS.prop7, name: 'Apto El Poblado 405',  address: 'Cra 43A # 10-80, El Poblado, Medellín', group: DEMO_IDS.group1, estrato: 5, bedrooms: 2, max_guests: 4, notes: 'Frente al parque Lleras.',         cleaningFee: 80_000, rnt: 'RNT-112233', baseRate: 480_000 },
];

export const DEMO_PROPERTIES: PropertyRow[] = PROP_SPECS.map(p => ({
  id: p.id,
  owner_id: OWNER_ID,
  name: p.name,
  address: p.address,
  base_currency: 'COP',
  estrato: p.estrato,
  bedrooms: p.bedrooms,
  max_guests: p.max_guests,
  notes: p.notes,
  created_at: offsetIsoTs(-300 - randInt(0, 60)),
  default_cleaning_fee: p.cleaningFee,
  rnt: p.rnt,
  group_id: p.group,
}));

// ── Listings (1 por propiedad, canal alternado) ─────────────────────────────
const LISTING_SOURCES = ['airbnb', 'booking', 'airbnb', 'booking', 'airbnb', 'direct', 'airbnb'] as const;
export const DEMO_LISTINGS: ListingRow[] = PROP_SPECS.map((p, i) => ({
  id: ALL_LISTING_IDS[i],
  property_id: p.id,
  external_name: `${p.name} - ${LISTING_SOURCES[i]}`,
  source: LISTING_SOURCES[i],
  created_at: offsetIsoTs(-280 - i * 5),
}));

// ── Tag assignments ─────────────────────────────────────────────────────────
const TAG_ASSIGNMENT_MAP: Record<string, string[]> = {
  [DEMO_IDS.prop1]: [DEMO_IDS.tagPremium, DEMO_IDS.tagVistaParque],
  [DEMO_IDS.prop2]: [DEMO_IDS.tagPremium, DEMO_IDS.tagMetro],
  [DEMO_IDS.prop3]: [DEMO_IDS.tagPetFriendly],
  [DEMO_IDS.prop4]: [DEMO_IDS.tagVacacional, DEMO_IDS.tagPremium],
  [DEMO_IDS.prop5]: [DEMO_IDS.tagPetFriendly, DEMO_IDS.tagVacacional],
  [DEMO_IDS.prop6]: [DEMO_IDS.tagMetro],
  [DEMO_IDS.prop7]: [DEMO_IDS.tagPremium, DEMO_IDS.tagVistaParque],
};

export const DEMO_PROPERTY_TAG_ASSIGNMENTS: PropertyTagAssignmentRow[] =
  Object.entries(TAG_ASSIGNMENT_MAP).flatMap(([propertyId, tagIds]) =>
    tagIds.map(tagId => ({
      property_id: propertyId,
      tag_id: tagId,
      owner_id: OWNER_ID,
      created_at: offsetIsoTs(-280),
    })),
  );

// ── Bank accounts ───────────────────────────────────────────────────────────
export const DEMO_BANK_ACCOUNTS: BankAccountRow[] = [
  {
    id: DEMO_IDS.bank1,
    owner_id: OWNER_ID,
    name: 'Bancolombia Ahorros',
    bank: 'Bancolombia',
    account_type: 'ahorros',
    account_number_mask: '****4521',
    currency: 'COP',
    opening_balance: 8_000_000,
    is_active: true,
    notes: 'Cuenta principal de payouts (Airbnb + Booking).',
    created_at: offsetIsoTs(-365),
    is_credit: false,
    credit_limit: null,
    is_cash: false,
  },
  {
    id: DEMO_IDS.bank2,
    owner_id: OWNER_ID,
    name: 'Davivienda Corriente',
    bank: 'Davivienda',
    account_type: 'corriente',
    account_number_mask: '****9876',
    currency: 'COP',
    opening_balance: 3_500_000,
    is_active: true,
    notes: 'Cuenta operativa para gastos, depósitos de seguridad y pagos directos.',
    created_at: offsetIsoTs(-330),
    is_credit: false,
    credit_limit: null,
    is_cash: false,
  },
  {
    id: DEMO_IDS.bankCash,
    owner_id: OWNER_ID,
    name: 'Efectivo',
    bank: null,
    account_type: 'otro',
    account_number_mask: null,
    currency: 'COP',
    opening_balance: 250_000,
    is_active: true,
    notes: 'Caja menor para gastos rápidos y propinas.',
    created_at: offsetIsoTs(-365),
    is_credit: false,
    credit_limit: null,
    is_cash: true,
  },
];

// ── Vendors ─────────────────────────────────────────────────────────────────
export const DEMO_VENDORS: VendorRow[] = [
  {
    id: DEMO_IDS.vendorClean,
    owner_id: OWNER_ID,
    name: 'Marta Pérez (Aseo)',
    kind: 'cleaner',
    contact: '+57 310 555 1234',
    notes: 'Disponible lunes a sábado.',
    active: true,
    created_at: offsetIsoTs(-200),
    category: 'Aseo',
    default_amount: 60_000,
    day_of_month: null,
    is_variable: true,
    start_year_month: null,
  },
  {
    id: DEMO_IDS.vendorClean2,
    owner_id: OWNER_ID,
    name: 'Diana Castaño (Aseo)',
    kind: 'cleaner',
    contact: '+57 311 444 5566',
    notes: 'Cubre fines de semana y Envigado.',
    active: true,
    created_at: offsetIsoTs(-160),
    category: 'Aseo',
    default_amount: 70_000,
    day_of_month: null,
    is_variable: true,
    start_year_month: null,
  },
  {
    id: DEMO_IDS.vendorMaint,
    owner_id: OWNER_ID,
    name: 'Carlos Restrepo (Mantenimiento)',
    kind: 'maintenance',
    contact: '+57 320 555 6789',
    notes: 'Plomería y electricidad.',
    active: true,
    created_at: offsetIsoTs(-180),
    category: 'Mantenimiento',
    default_amount: null,
    day_of_month: null,
    is_variable: true,
    start_year_month: null,
  },
  {
    id: DEMO_IDS.vendorLaundry,
    owner_id: OWNER_ID,
    name: 'Lavaseco Express',
    kind: 'business_service',
    contact: '+57 4 555 0000',
    notes: 'Recogen y entregan en 24h.',
    active: true,
    created_at: offsetIsoTs(-150),
    category: 'Lavandería',
    default_amount: 35_000,
    day_of_month: null,
    is_variable: true,
    start_year_month: null,
  },
];

export const DEMO_VENDOR_PROPERTIES: VendorPropertyRow[] = [
  // Marta cubre Poblado y Laureles
  ...[DEMO_IDS.prop1, DEMO_IDS.prop2, DEMO_IDS.prop3, DEMO_IDS.prop4, DEMO_IDS.prop7].map((pid, i) => ({
    id: `demo-vp-clean-${i + 1}`,
    vendor_id: DEMO_IDS.vendorClean,
    property_id: pid,
    share_percent: 100,
    fixed_amount: null,
    created_at: offsetIsoTs(-200),
  })),
  // Diana cubre Envigado
  ...[DEMO_IDS.prop5, DEMO_IDS.prop6].map((pid, i) => ({
    id: `demo-vp-clean2-${i + 1}`,
    vendor_id: DEMO_IDS.vendorClean2,
    property_id: pid,
    share_percent: 100,
    fixed_amount: null,
    created_at: offsetIsoTs(-160),
  })),
  // Carlos cubre todas
  ...ALL_PROP_IDS.map((pid, i) => ({
    id: `demo-vp-maint-${i + 1}`,
    vendor_id: DEMO_IDS.vendorMaint,
    property_id: pid,
    share_percent: 100,
    fixed_amount: null,
    created_at: offsetIsoTs(-180),
  })),
];

// ── Cleaner groups ──────────────────────────────────────────────────────────
export const DEMO_CLEANER_GROUPS: CleanerGroupRow[] = [
  { id: DEMO_IDS.cleanerGroup, owner_id: OWNER_ID, name: 'Equipo Marta', color: '#10b981', created_at: offsetIsoTs(-200) },
];

// ── Bookings ────────────────────────────────────────────────────────────────
// Generación procedural: cubrimos las 7 propiedades, repartimos payouts entre
// los 2 bancos (bank1: principal, bank2: directos / depósito de seguridad).
type BookingSpec = {
  daysFromToday: number;
  nights: number;
  propIdx: number; // 0..6
  status: 'Completada' | 'Reservada' | 'Cancelada';
  guests: { adults: number; children: number };
  rateMul: number; // multiplicador sobre baseRate de la propiedad
  withPayout: boolean;
  channel: 'airbnb' | 'booking' | 'direct';
  channelFeesRate?: number;
  payoutAcc?: 'bank1' | 'bank2';
};

const buildBookingSpecs = (): BookingSpec[] => {
  const specs: BookingSpec[] = [];
  // Distribución aproximada: 11 bookings por propiedad × 7 = 77, mezclados.
  let day = -95;
  let idx = 0;
  while (day <= 60 && specs.length < 80) {
    const propIdx = idx % 7;
    const nights = 2 + (idx % 5);
    const isPast = day + nights < 0;
    const isRecent = day < 0 && day + nights >= -2;
    const isFuture = day >= 0;
    let status: BookingSpec['status'] = 'Reservada';
    if (isPast) {
      status = idx % 13 === 5 ? 'Cancelada' : 'Completada';
    } else if (isRecent) {
      status = 'Completada';
    } else if (isFuture) {
      status = 'Reservada';
    }
    const channelPick = idx % 5;
    const channel: BookingSpec['channel'] = channelPick === 0 ? 'direct' : channelPick === 1 || channelPick === 4 ? 'booking' : 'airbnb';
    const channelFeesRate = channel === 'booking' ? 0.15 : channel === 'airbnb' ? 0.03 : undefined;
    const rateMul = 0.95 + ((idx % 7) * 0.025);
    // Payouts pasados: 70% bank1, 30% bank2 (variar)
    const payoutAcc: 'bank1' | 'bank2' = idx % 10 < 7 ? 'bank1' : 'bank2';
    specs.push({
      daysFromToday: day,
      nights,
      propIdx,
      status,
      guests: { adults: 1 + (idx % 3), children: idx % 5 === 0 ? 1 : 0 },
      rateMul,
      withPayout: status === 'Completada',
      channel,
      channelFeesRate,
      payoutAcc,
    });
    day += 1 + (idx % 3); // espaciado variable
    idx++;
  }
  return specs;
};

const BOOKING_SPECS: BookingSpec[] = buildBookingSpecs();

const GUEST_NAMES = [
  'María Rodríguez', 'James Wilson', 'Sofía Martínez', 'Lucas Müller', 'Camila Gómez',
  'Andrew Smith', 'Valentina Ríos', 'Emma Schmidt', 'Daniel Pérez', 'Olivia Brown',
  'Mateo Castaño', 'Hannah Davis', 'Isabella López', 'Liam Johnson', 'Mariana Vélez',
  'Noah García', 'Antonella Ruiz', 'Ethan Taylor', 'Ana Quintero', 'Mason Lee',
  'Renata Salazar', 'Jacob Walker', 'Luciana Henao', 'Lucas Anderson', 'Manuela Ortiz',
  'Benjamín Torres', 'Charlotte Hall', 'Tomás Mejía', 'Sophia Allen', 'Samuel Cárdenas',
  'Mía Cardona', 'Henry Young', 'Emiliano Arango', 'Amelia King', 'Joaquín Bedoya',
  'Valeria Posada', 'William Clark', 'Catalina Jaramillo', 'Oliver Wright', 'Susana Marín',
];

export const DEMO_BOOKINGS: BookingRow[] = BOOKING_SPECS.map((spec, idx) => {
  const start = addDays(today, spec.daysFromToday);
  const end = addDays(start, spec.nights);
  const bookedAt = addDays(start, -randInt(10, 40));
  const listingId = ALL_LISTING_IDS[spec.propIdx];
  const propSpec = PROP_SPECS[spec.propIdx];
  const rate = Math.round(propSpec.baseRate * spec.rateMul);
  const isCancelled = spec.status === 'Cancelada';
  const grossRevenue = isCancelled ? 0 : rate * spec.nights;
  const channelFees = spec.channelFeesRate ? Math.round(grossRevenue * spec.channelFeesRate) : 0;
  const totalRevenue = grossRevenue;
  const netPayout = spec.withPayout ? grossRevenue - channelFees : null;
  const isPast = spec.daysFromToday + spec.nights < 0;
  const payoutAccId = spec.payoutAcc === 'bank2' ? DEMO_IDS.bank2 : DEMO_IDS.bank1;
  const hasDeposit = idx % 6 === 0 && !isCancelled;

  return {
    id: `demo-bk-${String(idx + 1).padStart(3, '0')}`,
    listing_id: listingId,
    confirmation_code: `HM${String(100000 + idx * 137).padStart(6, '0')}`,
    guest_name: GUEST_NAMES[idx % GUEST_NAMES.length],
    start_date: iso(start),
    end_date: iso(end),
    booked_at: isoTs(bookedAt),
    num_nights: spec.nights,
    num_adults: spec.guests.adults,
    num_children: spec.guests.children,
    total_revenue: totalRevenue,
    status: spec.status,
    raw_data: null,
    created_at: isoTs(bookedAt),
    channel: spec.channel,
    gross_revenue: grossRevenue,
    channel_fees: channelFees,
    taxes_withheld: 0,
    net_payout: netPayout,
    payout_bank_account_id: spec.withPayout ? payoutAccId : null,
    payout_date: spec.withPayout && isPast ? iso(addDays(end, 3)) : null,
    currency: 'COP',
    exchange_rate: null,
    notes: null,
    checkin_done: isPast || spec.daysFromToday <= 0,
    checkout_done: isPast,
    inventory_checked: isPast,
    operational_notes: null,
    security_deposit: hasDeposit ? 300_000 : null,
    deposit_bank_account_id: hasDeposit ? DEMO_IDS.bank2 : null,
    deposit_status: hasDeposit ? (isPast ? 'returned' : 'received') : 'none',
    deposit_returned_amount: hasDeposit && isPast ? 300_000 : null,
    deposit_return_date: hasDeposit && isPast ? iso(addDays(end, 5)) : null,
  };
});

// ── Booking adjustments ─────────────────────────────────────────────────────
const pickPastCompleted = (offset: number): BookingRow | undefined =>
  DEMO_BOOKINGS.filter(b => b.status === 'Completada')[offset];

export const DEMO_BOOKING_ADJUSTMENTS: BookingAdjustmentRow[] = (() => {
  const out: BookingAdjustmentRow[] = [];
  const b1 = pickPastCompleted(5);
  const b2 = pickPastCompleted(12);
  const b3 = pickPastCompleted(18);
  const b4 = pickPastCompleted(25);
  if (b1) out.push({ id: 'demo-adj-1', booking_id: b1.id, kind: 'damage_charge',    amount: 180_000, description: 'Mancha en sofá',              date: b1.end_date,   created_at: offsetIsoTs(-62), bank_account_id: DEMO_IDS.bank2 });
  if (b2) out.push({ id: 'demo-adj-2', booking_id: b2.id, kind: 'extra_guest_fee',  amount: 80_000,  description: 'Huésped adicional',           date: b2.start_date, created_at: offsetIsoTs(-45), bank_account_id: DEMO_IDS.bank1 });
  if (b3) out.push({ id: 'demo-adj-3', booking_id: b3.id, kind: 'discount',         amount: 120_000, description: 'Descuento estadía larga',     date: b3.start_date, created_at: offsetIsoTs(-26), bank_account_id: null });
  if (b4) out.push({ id: 'demo-adj-4', booking_id: b4.id, kind: 'platform_refund',  amount: 95_000,  description: 'Reembolso de plataforma',     date: b4.end_date,   created_at: offsetIsoTs(-18), bank_account_id: DEMO_IDS.bank1 });
  return out;
})();

// ── Expenses ────────────────────────────────────────────────────────────────
const monthDate = (monthsAgo: number, day: number): string => {
  const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
  return iso(d);
};

const fixedExpenses = (): ExpenseRow[] => {
  const out: ExpenseRow[] = [];
  let cnt = 1;
  for (let m = 3; m >= 0; m--) {
    for (const p of PROP_SPECS) {
      const isLarge = p.bedrooms >= 2;
      const items: Array<{ cat: string; sub: string; amount: number; day: number; desc: string; status: 'pending' | 'paid'; cash?: boolean }> = [
        { cat: 'Servicios públicos', sub: 'utilities',      amount: isLarge ? 230_000 : 175_000, day: 5,  desc: 'EPM agua + luz',           status: m === 0 ? 'pending' : 'paid' },
        { cat: 'Servicios públicos', sub: 'utilities',      amount: 89_000,                      day: 8,  desc: 'Internet Claro 200Mbps',  status: m === 0 ? 'pending' : 'paid' },
        { cat: 'Administración',     sub: 'administration', amount: isLarge ? 480_000 : 380_000, day: 5,  desc: 'Cuota P.H.',               status: m === 0 ? 'pending' : 'paid' },
        { cat: 'Administración',     sub: 'administration', amount: isLarge ? 195_000 : 165_000, day: 5,  desc: 'Seguros Bolívar - hogar', status: 'paid' },
      ];
      for (const item of items) {
        out.push({
          id: `demo-exp-fix-${String(cnt++).padStart(3, '0')}`,
          owner_id: OWNER_ID,
          property_id: p.id,
          category: item.cat,
          type: 'fixed',
          amount: item.amount,
          currency: 'COP',
          date: monthDate(m, item.day),
          description: item.desc,
          status: item.status,
          created_at: offsetIsoTs(-(m * 30)),
          bank_account_id: item.status === 'paid' ? (item.cash ? DEMO_IDS.bankCash : DEMO_IDS.bank2) : null,
          booking_id: null,
          vendor: null,
          person_in_charge: null,
          adjustment_id: null,
          vendor_id: null,
          shared_bill_id: null,
          subcategory: item.sub,
          expense_group_id: null,
        });
      }
    }
  }
  return out;
};

const variableExpenses = (): ExpenseRow[] => {
  const out: ExpenseRow[] = [];
  let cnt = 1;
  for (const b of DEMO_BOOKINGS) {
    if (b.status === 'Cancelada') continue;
    const start = new Date(b.start_date + 'T12:00:00');
    if (start > today) continue;
    const propSpec = PROP_SPECS.find(p => ALL_LISTING_IDS[PROP_SPECS.indexOf(p)] === b.listing_id);
    if (!propSpec) continue;
    const propId = propSpec.id;
    const isEnvigado = propSpec.group === DEMO_IDS.group3;
    // Aseo (Marta o Diana según grupo)
    out.push({
      id: `demo-exp-var-${String(cnt++).padStart(3, '0')}`,
      owner_id: OWNER_ID,
      property_id: propId,
      category: 'Aseo y lavandería',
      type: 'variable',
      amount: propSpec.cleaningFee,
      currency: 'COP',
      date: b.end_date,
      description: `Aseo turno ${b.confirmation_code}`,
      status: 'paid',
      created_at: offsetIsoTs(-1),
      bank_account_id: DEMO_IDS.bank2,
      booking_id: b.id,
      vendor: isEnvigado ? 'Diana Castaño' : 'Marta Pérez',
      person_in_charge: null,
      adjustment_id: null,
      vendor_id: isEnvigado ? DEMO_IDS.vendorClean2 : DEMO_IDS.vendorClean,
      shared_bill_id: null,
      subcategory: 'cleaning',
      expense_group_id: null,
    });
    // Lavandería cada 2 reservas
    if (cnt % 2 === 0) {
      out.push({
        id: `demo-exp-var-${String(cnt++).padStart(3, '0')}`,
        owner_id: OWNER_ID,
        property_id: propId,
        category: 'Aseo y lavandería',
        type: 'variable',
        amount: 35_000,
        currency: 'COP',
        date: b.end_date,
        description: 'Lavandería sábanas y toallas',
        status: 'paid',
        created_at: offsetIsoTs(-1),
        bank_account_id: DEMO_IDS.bank2,
        booking_id: b.id,
        vendor: 'Lavaseco Express',
        person_in_charge: null,
        adjustment_id: null,
        vendor_id: DEMO_IDS.vendorLaundry,
        shared_bill_id: null,
        subcategory: 'cleaning',
        expense_group_id: null,
      });
    }
    // Welcome kit cada 3 reservas — pagado en efectivo
    if (cnt % 3 === 0) {
      out.push({
        id: `demo-exp-var-${String(cnt++).padStart(3, '0')}`,
        owner_id: OWNER_ID,
        property_id: propId,
        category: 'Atenciones al huésped',
        type: 'variable',
        amount: 45_000,
        currency: 'COP',
        date: b.start_date,
        description: 'Welcome kit (snacks + vino)',
        status: 'paid',
        created_at: offsetIsoTs(-1),
        bank_account_id: DEMO_IDS.bankCash,
        booking_id: b.id,
        vendor: null,
        person_in_charge: null,
        adjustment_id: null,
        vendor_id: null,
        shared_bill_id: null,
        subcategory: 'guest_amenities',
        expense_group_id: null,
      });
    }
  }
  // Mantenimientos esporádicos (uno por grupo)
  const maintEntries: Array<{ propId: string; days: number; desc: string; amount: number }> = [
    { propId: DEMO_IDS.prop1, days: -58, desc: 'Plomero - grifo cocina',           amount: 480_000 },
    { propId: DEMO_IDS.prop3, days: -22, desc: 'Cambio cerradura inteligente',     amount: 320_000 },
    { propId: DEMO_IDS.prop5, days: -38, desc: 'Pintura sala + retoque cocina',    amount: 720_000 },
    { propId: DEMO_IDS.prop2, days: -12, desc: 'Revisión técnica gasodoméstico',   amount: 180_000 },
    { propId: DEMO_IDS.prop7, days:  -5, desc: 'Reparación lámpara colgante',      amount: 90_000  },
  ];
  for (const m of maintEntries) {
    out.push({
      id: `demo-exp-maint-${m.propId.slice(-3)}-${Math.abs(m.days)}`,
      owner_id: OWNER_ID,
      property_id: m.propId,
      category: 'Mantenimiento',
      type: 'variable',
      amount: m.amount,
      currency: 'COP',
      date: offsetIso(m.days),
      description: m.desc,
      status: 'paid',
      created_at: offsetIsoTs(m.days),
      bank_account_id: DEMO_IDS.bank2,
      booking_id: null,
      vendor: 'Carlos Restrepo',
      person_in_charge: null,
      adjustment_id: null,
      vendor_id: DEMO_IDS.vendorMaint,
      shared_bill_id: null,
      subcategory: 'maintenance',
      expense_group_id: null,
    });
  }
  return out;
};

export const DEMO_EXPENSES: ExpenseRow[] = [...fixedExpenses(), ...variableExpenses()];

// ── Recurring expenses ──────────────────────────────────────────────────────
export const DEMO_RECURRING_EXPENSES: PropertyRecurringExpenseRow[] = PROP_SPECS.flatMap((p, i) => [
  {
    id: `demo-rec-${i}-internet`,
    property_id: p.id,
    category: 'Servicios públicos',
    amount: 89_000,
    is_active: true,
    day_of_month: 8,
    description: 'Internet Claro',
    created_at: offsetIsoTs(-200),
    valid_from: offsetIso(-200),
    valid_to: null,
    vendor: null,
    person_in_charge: null,
    vendor_id: null,
    is_shared: false,
  },
  {
    id: `demo-rec-${i}-admin`,
    property_id: p.id,
    category: 'Administración',
    amount: p.bedrooms >= 2 ? 480_000 : 380_000,
    is_active: true,
    day_of_month: 5,
    description: 'Cuota P.H.',
    created_at: offsetIsoTs(-200),
    valid_from: offsetIso(-200),
    valid_to: null,
    vendor: null,
    person_in_charge: null,
    vendor_id: null,
    is_shared: false,
  },
]);

// ── Cleanings ───────────────────────────────────────────────────────────────
export const DEMO_CLEANINGS: BookingCleaningRow[] = DEMO_BOOKINGS
  .filter(b => b.status !== 'Cancelada')
  .slice(0, 24)
  .map((b, idx) => {
    const isPast = new Date(b.end_date + 'T12:00:00') < today;
    const isEnvigado = DEMO_LISTINGS.find(l => l.id === b.listing_id)?.property_id === DEMO_IDS.prop5
      || DEMO_LISTINGS.find(l => l.id === b.listing_id)?.property_id === DEMO_IDS.prop6;
    return {
      id: `demo-clean-${String(idx + 1).padStart(3, '0')}`,
      booking_id: b.id,
      cleaner_id: isEnvigado ? DEMO_IDS.vendorClean2 : DEMO_IDS.vendorClean,
      fee: isEnvigado ? 70_000 : 60_000,
      status: isPast ? 'paid' : 'pending',
      done_date: isPast ? b.end_date : null,
      paid_date: isPast ? iso(addDays(new Date(b.end_date), 2)) : null,
      notes: null,
      created_at: offsetIsoTs(-randInt(0, 60)),
      supplies_amount: 0,
      reimburse_to_cleaner: false,
    };
  });

// ── Inventory ───────────────────────────────────────────────────────────────
export const DEMO_INVENTORY_CATEGORIES: InventoryCategoryRow[] = [
  { id: DEMO_IDS.inventoryCat1, owner_id: OWNER_ID, name: 'Electrónica',  icon: 'tv',     created_at: offsetIsoTs(-200) },
  { id: DEMO_IDS.inventoryCat2, owner_id: OWNER_ID, name: 'Ropa de cama', icon: 'bed',    created_at: offsetIsoTs(-200) },
  { id: DEMO_IDS.inventoryCat3, owner_id: OWNER_ID, name: 'Cocina',       icon: 'kitchen', created_at: offsetIsoTs(-200) },
  { id: DEMO_IDS.inventoryCat4, owner_id: OWNER_ID, name: 'Decoración',   icon: 'lamp',   created_at: offsetIsoTs(-200) },
];

const invItem = (
  id: string,
  propId: string,
  catId: string,
  name: string,
  status: 'good' | 'needs_maintenance' | 'damaged' = 'good',
  qty = 1,
  price = 100_000,
): InventoryItemRow => ({
  id,
  owner_id: OWNER_ID,
  property_id: propId,
  category_id: catId,
  name,
  description: null,
  location: null,
  status,
  quantity: qty,
  unit: null,
  min_stock: null,
  is_consumable: false,
  purchase_date: offsetIso(-200),
  purchase_price: price,
  expected_lifetime_months: 60,
  photo_url: null,
  notes: null,
  created_at: offsetIsoTs(-200),
  updated_at: offsetIsoTs(-30),
});

// Generamos ~6 ítems base por propiedad
const baseInventoryFor = (propId: string, label: string): InventoryItemRow[] => [
  invItem(`demo-inv-${propId}-tv`,    propId, DEMO_IDS.inventoryCat1, `Smart TV ${label}`,        'good',  1, 1_900_000),
  invItem(`demo-inv-${propId}-mw`,    propId, DEMO_IDS.inventoryCat1, `Microondas ${label}`,      'good',  1, 450_000),
  invItem(`demo-inv-${propId}-sheet`, propId, DEMO_IDS.inventoryCat2, `Sábanas ${label}`,         'good',  3, 170_000),
  invItem(`demo-inv-${propId}-tow`,   propId, DEMO_IDS.inventoryCat2, `Toallas ${label}`,         'good',  6, 32_000),
  invItem(`demo-inv-${propId}-pot`,   propId, DEMO_IDS.inventoryCat3, `Ollas ${label}`,           'good',  1, 240_000),
  invItem(`demo-inv-${propId}-lamp`,  propId, DEMO_IDS.inventoryCat4, `Lámpara ${label}`,         'good',  1, 130_000),
];

export const DEMO_INVENTORY_ITEMS: InventoryItemRow[] = PROP_SPECS.flatMap(p =>
  baseInventoryFor(p.id, p.name.split(' ').slice(-1)[0]),
);
// Marcar 2 items con problemas para que aparezcan en el panel "Pendientes"
if (DEMO_INVENTORY_ITEMS[1]) DEMO_INVENTORY_ITEMS[1] = { ...DEMO_INVENTORY_ITEMS[1], status: 'damaged' };
if (DEMO_INVENTORY_ITEMS[14]) DEMO_INVENTORY_ITEMS[14] = { ...DEMO_INVENTORY_ITEMS[14], status: 'needs_maintenance' };

// ── Maintenance ─────────────────────────────────────────────────────────────
export const DEMO_MAINTENANCE: MaintenanceScheduleRow[] = [
  {
    id: 'demo-maint-1',
    owner_id: OWNER_ID,
    item_id: DEMO_INVENTORY_ITEMS[1].id,
    property_id: DEMO_INVENTORY_ITEMS[1].property_id,
    title: 'Revisión microondas',
    description: 'Limpieza interna y revisión de magnetrón.',
    scheduled_date: offsetIso(10),
    status: 'pending',
    notify_before_days: 3,
    email_notify: true,
    is_recurring: true,
    recurrence_days: 90,
    expense_registered: false,
    created_at: offsetIsoTs(-30),
    updated_at: offsetIsoTs(-30),
  },
  {
    id: 'demo-maint-2',
    owner_id: OWNER_ID,
    item_id: DEMO_INVENTORY_ITEMS[14].id,
    property_id: DEMO_INVENTORY_ITEMS[14].property_id,
    title: 'Fumigación general',
    description: 'Fumigación trimestral.',
    scheduled_date: offsetIso(18),
    status: 'pending',
    notify_before_days: 5,
    email_notify: true,
    is_recurring: true,
    recurrence_days: 90,
    expense_registered: false,
    created_at: offsetIsoTs(-25),
    updated_at: offsetIsoTs(-25),
  },
  {
    id: 'demo-maint-3',
    owner_id: OWNER_ID,
    item_id: DEMO_INVENTORY_ITEMS[0].id,
    property_id: DEMO_INVENTORY_ITEMS[0].property_id,
    title: 'Revisión técnica TV',
    description: 'Calibración de color y firmware.',
    scheduled_date: offsetIso(45),
    status: 'pending',
    notify_before_days: 5,
    email_notify: false,
    is_recurring: false,
    recurrence_days: null,
    expense_registered: false,
    created_at: offsetIsoTs(-10),
    updated_at: offsetIsoTs(-10),
  },
];

// ── Credit pool ─────────────────────────────────────────────────────────────
export const DEMO_CREDIT_POOLS: CreditPoolRow[] = [
  {
    id: DEMO_IDS.creditPool,
    owner_id: OWNER_ID,
    vendor_id: null,
    name: 'Seguro Anfitrión 2026',
    credits_total: 100,
    credits_used: 23,
    total_price: 850_000,
    consumption_rule: 'per_person_per_night',
    credits_per_unit: 1,
    child_weight: 0.5,
    activated_at: offsetIsoTs(-60),
    expires_at: offsetIso(305),
    status: 'active',
    notes: 'Cubre daños hasta 5M COP por evento.',
    expense_id: null,
    created_at: offsetIsoTs(-60),
  },
];

// ── Account deposits (aportes manuales en varias cuentas) ───────────────────
export const DEMO_ACCOUNT_DEPOSITS: AccountDepositRow[] = [
  { id: 'demo-dep-1', owner_id: OWNER_ID, account_id: DEMO_IDS.bank1,    amount: 1_500_000, deposit_date: offsetIso(-45), notes: 'Aporte de capital propio',           created_at: offsetIsoTs(-45) },
  { id: 'demo-dep-2', owner_id: OWNER_ID, account_id: DEMO_IDS.bank2,    amount:   500_000, deposit_date: offsetIso(-30), notes: 'Transferencia desde Bancolombia',    created_at: offsetIsoTs(-30) },
  { id: 'demo-dep-3', owner_id: OWNER_ID, account_id: DEMO_IDS.bankCash, amount:   200_000, deposit_date: offsetIso(-12), notes: 'Retiro para caja menor',             created_at: offsetIsoTs(-12) },
];

// ── Notification settings ───────────────────────────────────────────────────
export const DEMO_NOTIFICATION_SETTINGS = {
  user_id: OWNER_ID,
  reminders_enabled: true,
  email_enabled: true,
  lead_days: 3,
  repeat_cadence: 'every_2_days' as const,
  send_hour: 8,
  notify_recurring: true,
  notify_maintenance: true,
  notify_shared_bills: true,
  notify_damage: true,
  notify_cleaner: true,
  timezone: 'America/Bogota',
  updated_at: offsetIsoTs(-30),
};

export const DEMO_OWNER_ID = OWNER_ID;
