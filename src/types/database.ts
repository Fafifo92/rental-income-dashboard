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
}
