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
  property_id: string;
  category_id: string;
  amount: number;
  date: string;
  description: string | null;
  status: 'pending' | 'paid' | 'partial';
}

export interface FinancialMetrics {
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  occupancyRate: number;
  adr: number;
  revpar: number;
}
