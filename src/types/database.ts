// Mirror of the Supabase PostgreSQL schema — no `any` allowed.

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, 'created_at'>;
        Update: Partial<Omit<ProfileRow, 'id' | 'created_at'>>;
      };
      properties: {
        Row: PropertyRow;
        Insert: Omit<PropertyRow, 'id' | 'created_at'>;
        Update: Partial<Omit<PropertyRow, 'id' | 'created_at'>>;
      };
      listings: {
        Row: ListingRow;
        Insert: Omit<ListingRow, 'id' | 'created_at'>;
        Update: Partial<Omit<ListingRow, 'id' | 'created_at'>>;
      };
      bookings: {
        Row: BookingRow;
        Insert: Omit<BookingRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BookingRow, 'id' | 'created_at'>>;
      };
      expenses: {
        Row: ExpenseRow;
        Insert: Omit<ExpenseRow, 'id' | 'created_at'>;
        Update: Partial<Omit<ExpenseRow, 'id' | 'created_at'>>;
      };
      property_recurring_expenses: {
        Row: PropertyRecurringExpenseRow;
        Insert: Omit<PropertyRecurringExpenseRow, 'id' | 'created_at'>;
        Update: Partial<Omit<PropertyRecurringExpenseRow, 'id' | 'created_at'>>;
      };
      bank_accounts: {
        Row: BankAccountRow;
        Insert: Omit<BankAccountRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BankAccountRow, 'id' | 'created_at'>>;
      };
      booking_adjustments: {
        Row: BookingAdjustmentRow;
        Insert: Omit<BookingAdjustmentRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BookingAdjustmentRow, 'id' | 'created_at'>>;
      };
    };
  };
}

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'owner';
  created_at: string;
}

export interface PropertyRow {
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
}

export interface PropertyRecurringExpenseRow {
  id: string;
  property_id: string;
  category: string;
  amount: number;
  is_active: boolean;
  day_of_month: number | null;
  description: string | null;
  created_at: string;
  // Fase 8.1 — historial de precios
  valid_from: string;       // YYYY-MM-DD
  valid_to: string | null;  // NULL = vigente
  // Fase 9.1 — metadata administrativa
  vendor: string | null;
  person_in_charge: string | null;
}

export interface BankAccountRow {
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
}

export type BookingAdjustmentKind = 'extra_income' | 'discount' | 'damage_charge';

export interface BookingAdjustmentRow {
  id: string;
  booking_id: string;
  kind: BookingAdjustmentKind;
  amount: number;
  description: string | null;
  date: string;
  created_at: string;
}

export interface ListingRow {
  id: string;
  property_id: string;
  external_name: string;
  source: string;
  created_at: string;
}

export interface BookingRow {
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
  // Fase 9
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
}

export interface ExpenseRow {
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
  // Fase 9
  bank_account_id: string | null;
  booking_id: string | null;
  vendor: string | null;
  person_in_charge: string | null;
  // Fase 10 — vínculo fuerte con ajuste de reserva
  adjustment_id: string | null;
}
