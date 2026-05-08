import type { BookingFilters } from '@/services/bookings';

export interface DisplayBooking {
  id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
  listing_name: string;
  property_name?: string | null;
  listing_id?: string | null;
  /** Resolved from listings join — available without needing the separate listings cache. */
  property_id?: string | null;
  channel?: string | null;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_bank_account_id?: string | null;
  payout_date?: string | null;
  notes?: string | null;
  num_adults?: number | null;
  num_children?: number | null;
  checkin_done?: boolean;
  checkout_done?: boolean;
  inventory_checked?: boolean;
  operational_notes?: string | null;
  isDemo?: boolean;
}

export interface BookingForm {
  guest_name: string;
  confirmation_code: string;
  start_date: string;
  end_date: string;
  num_nights: string;
  total_revenue: string;
  status: string;
  listing_name: string;
  property_id: string;
  channel: string;
  num_adults: string;
  num_children: string;
  notes: string;
}

export const EMPTY_FORM: BookingForm = {
  guest_name: '', confirmation_code: '', start_date: '', end_date: '',
  num_nights: '', total_revenue: '', status: 'Reservada', listing_name: '', property_id: '',
  channel: '', num_adults: '1', num_children: '0', notes: '',
};

export const EMPTY_FILTERS: BookingFilters = {};
