export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'owner';
}

export interface Property {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  base_currency: string;
  /** Registro Nacional de Turismo (Colombia). */
  rnt?: string | null;
}

export interface Booking {
  id: string;
  listing_id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
}

export interface Expense {
  id: string;
  owner_id?: string;
  property_id?: string | null;
  category: string;
  subcategory?: string | null;
  type: 'fixed' | 'variable';
  amount: number;
  date: string;
  description: string | null;
  status: 'pending' | 'paid' | 'partial';
  bank_account_id?: string | null;
  vendor?: string | null;
  person_in_charge?: string | null;
  booking_id?: string | null;
  adjustment_id?: string | null;
  vendor_id?: string | null;
  shared_bill_id?: string | null;
  expense_group_id?: string | null;
}

export interface FinancialMetrics {
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  occupancyRate: number;
  adr: number;
  revpar: number;
}
