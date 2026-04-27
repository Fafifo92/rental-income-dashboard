// Mirror of the Supabase PostgreSQL schema — no `any` allowed.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, 'created_at'>;
        Update: Partial<Omit<ProfileRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      properties: {
        Row: PropertyRow;
        Insert: Omit<PropertyRow, 'id' | 'created_at'>;
        Update: Partial<Omit<PropertyRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      listings: {
        Row: ListingRow;
        Insert: Omit<ListingRow, 'id' | 'created_at'>;
        Update: Partial<Omit<ListingRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      bookings: {
        Row: BookingRow;
        Insert: Omit<BookingRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BookingRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      expenses: {
        Row: ExpenseRow;
        Insert: Omit<ExpenseRow, 'id' | 'created_at'>;
        Update: Partial<Omit<ExpenseRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      property_recurring_expenses: {
        Row: PropertyRecurringExpenseRow;
        Insert: Omit<PropertyRecurringExpenseRow, 'id' | 'created_at'>;
        Update: Partial<Omit<PropertyRecurringExpenseRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      bank_accounts: {
        Row: BankAccountRow;
        Insert: Omit<BankAccountRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BankAccountRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      booking_adjustments: {
        Row: BookingAdjustmentRow;
        Insert: Omit<BookingAdjustmentRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BookingAdjustmentRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      vendors: {
        Row: VendorRow;
        Insert: Omit<VendorRow, 'id' | 'created_at'>;
        Update: Partial<Omit<VendorRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      booking_cleanings: {
        Row: BookingCleaningRow;
        Insert: Omit<BookingCleaningRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BookingCleaningRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      recurring_expense_periods: {
        Row: RecurringExpensePeriodRow;
        Insert: Omit<RecurringExpensePeriodRow, 'id' | 'created_at'>;
        Update: Partial<Omit<RecurringExpensePeriodRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      user_notification_settings: {
        Row: UserNotificationSettingsRow;
        Insert: Omit<UserNotificationSettingsRow, 'updated_at'> & { updated_at?: string };
        Update: Partial<Omit<UserNotificationSettingsRow, 'user_id'>>;
        Relationships: [];
      };
      vendor_properties: {
        Row: VendorPropertyRow;
        Insert: Omit<VendorPropertyRow, 'id' | 'created_at'>;
        Update: Partial<Omit<VendorPropertyRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      shared_bills: {
        Row: SharedBillRow;
        Insert: Omit<SharedBillRow, 'id' | 'created_at'>;
        Update: Partial<Omit<SharedBillRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'owner';
  created_at: string;
};

export type PropertyRow = {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  base_currency: string;
  estrato: number | null;
  bedrooms: number | null;
  max_guests: number | null;
  notes: string | null;
  created_at: string;
  default_cleaning_fee: number | null;
};

export type PropertyRecurringExpenseRow = {
  id: string;
  property_id: string;
  category: string;
  amount: number;
  is_active: boolean;
  day_of_month: number | null;
  description: string | null;
  created_at: string;
  valid_from: string;
  valid_to: string | null;
  vendor: string | null;
  person_in_charge: string | null;
  vendor_id: string | null;
  is_shared: boolean;
};

export type BankAccountRow = {
  id: string;
  owner_id: string;
  name: string;
  bank: string | null;
  account_type: 'ahorros' | 'corriente' | 'billetera' | 'otro' | null;
  account_number_mask: string | null;
  currency: string;
  opening_balance: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
};

export type BookingAdjustmentKind = 'extra_income' | 'discount' | 'damage_charge';

export type BookingAdjustmentRow = {
  id: string;
  booking_id: string;
  kind: BookingAdjustmentKind;
  amount: number;
  description: string | null;
  date: string;
  created_at: string;
};

export type ListingRow = {
  id: string;
  property_id: string;
  external_name: string;
  source: string;
  created_at: string;
};

export type BookingRow = {
  id: string;
  listing_id: string;
  confirmation_code: string;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  booked_at: string | null;
  num_nights: number;
  num_adults: number;
  num_children: number;
  total_revenue: number;
  status: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  channel: string | null;
  gross_revenue: number | null;
  channel_fees: number | null;
  taxes_withheld: number | null;
  net_payout: number | null;
  payout_bank_account_id: string | null;
  payout_date: string | null;
  currency: string | null;
  exchange_rate: number | null;
  notes: string | null;
  checkin_done: boolean;
  checkout_done: boolean;
  inventory_checked: boolean;
  operational_notes: string | null;
};

export type ExpenseRow = {
  id: string;
  owner_id: string;
  property_id: string | null;
  category: string;
  type: 'fixed' | 'variable';
  amount: number;
  currency: string;
  date: string;
  description: string | null;
  status: 'pending' | 'paid' | 'partial';
  created_at: string;
  bank_account_id: string | null;
  booking_id: string | null;
  vendor: string | null;
  person_in_charge: string | null;
  adjustment_id: string | null;
  vendor_id: string | null;
  shared_bill_id: string | null;
  subcategory: string | null;
};

export type VendorKind = 'utility' | 'admin' | 'maintenance' | 'cleaner' | 'insurance' | 'other';

// ── Taxonomía Fase 16 (4+3) ──
export type ExpenseSection = 'property' | 'booking';

export type ExpenseSubcategory =
  // Sección 1: sobre propiedades
  | 'utilities'         // 1.1 Servicios públicos
  | 'administration'    // 1.2 Administración (admin, predial, seguros inmueble, valorización)
  | 'maintenance'       // 1.3 Mantenimiento (reparaciones, mejoras)
  | 'stock'             // 1.4 Stock e inventario (compras a granel)
  // Sección 2: sobre reservas
  | 'cleaning'          // 2.1 Aseo y lavandería del turn
  | 'damage'            // 2.2 Daños del huésped
  | 'guest_amenities';  // 2.3 Atenciones al huésped (welcome kit, regalos)

export const EXPENSE_SUBCATEGORY_META: Record<ExpenseSubcategory, {
  section: ExpenseSection; label: string; icon: string; description: string;
}> = {
  utilities:       { section: 'property', label: 'Servicios públicos',      icon: '⚡', description: 'Luz, agua, gas, internet, basura' },
  administration:  { section: 'property', label: 'Administración',          icon: '📋', description: 'Admin edificio, predial, seguros, valorización' },
  maintenance:     { section: 'property', label: 'Mantenimiento',           icon: '🔧', description: 'Reparaciones, mejoras, pintura' },
  stock:           { section: 'property', label: 'Stock e inventario',      icon: '📦', description: 'Compras a granel: papel, jabón, sábanas nuevas' },
  cleaning:        { section: 'booking',  label: 'Aseo y lavandería',       icon: '🧹', description: 'Pago al cleaner del turn + insumos usados' },
  damage:          { section: 'booking',  label: 'Daños del huésped',       icon: '⚠️', description: 'Daños causados durante la reserva' },
  guest_amenities: { section: 'booking',  label: 'Atenciones al huésped',   icon: '🎁', description: 'Welcome kit, regalos, snacks específicos' },
};

// Categorías legacy (display) — se mantienen para no romper datos históricos
export type ExpenseCategory =
  | 'Servicios públicos'
  | 'Administración'
  | 'Mantenimiento'
  | 'Stock e inventario'
  | 'Aseo y lavandería'
  | 'Daños del huésped'
  | 'Atenciones al huésped'
  | 'Otros';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Servicios públicos',
  'Administración',
  'Mantenimiento',
  'Stock e inventario',
  'Aseo y lavandería',
  'Daños del huésped',
  'Atenciones al huésped',
  'Otros',
];

/** Mapea categoría visible ↔ subcategoría canónica (id estable). */
export const SUBCATEGORY_TO_CATEGORY: Record<ExpenseSubcategory, ExpenseCategory> = {
  utilities:       'Servicios públicos',
  administration:  'Administración',
  maintenance:     'Mantenimiento',
  stock:           'Stock e inventario',
  cleaning:        'Aseo y lavandería',
  damage:          'Daños del huésped',
  guest_amenities: 'Atenciones al huésped',
};

export type VendorRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: VendorKind;
  contact: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  category: string | null;
  default_amount: number | null;
  day_of_month: number | null;
  is_variable: boolean;
};

export type VendorPropertyRow = {
  id: string;
  vendor_id: string;
  property_id: string;
  share_percent: number | null;
  fixed_amount: number | null;
  created_at: string;
};

export type SharedBillRow = {
  id: string;
  vendor_id: string;
  year_month: string;
  total_amount: number;
  paid_date: string;
  bank_account_id: string | null;
  category: string | null;
  notes: string | null;
  created_at: string;
};

export type CleaningStatus = 'pending' | 'done' | 'paid';

export type BookingCleaningRow = {
  id: string;
  booking_id: string;
  cleaner_id: string | null;
  fee: number;
  status: CleaningStatus;
  done_date: string | null;
  paid_date: string | null;
  notes: string | null;
  created_at: string;
  supplies_amount: number;
  reimburse_to_cleaner: boolean;
};

export type RecurringPeriodStatus = 'paid' | 'skipped';

export type RecurringExpensePeriodRow = {
  id: string;
  recurring_id: string;
  year_month: string;   // 'YYYY-MM'
  status: RecurringPeriodStatus;
  expense_id: string | null;
  paid_at: string | null;
  amount: number | null;
  note: string | null;
  created_at: string;
};

export type NotificationCadence = 'daily' | 'every_2_days' | 'weekly';

export type UserNotificationSettingsRow = {
  user_id: string;
  reminders_enabled: boolean;
  email_enabled: boolean;
  lead_days: number;
  repeat_cadence: NotificationCadence;
  send_hour: number;
  notify_recurring: boolean;
  notify_maintenance: boolean;
  notify_shared_bills: boolean;
  notify_damage: boolean;
  notify_cleaner: boolean;
  updated_at: string;
};
