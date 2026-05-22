import { describe, it, expect } from 'vitest';
import { getBookingStatus } from './bookingStatus';

const TODAY = '2026-05-21';

describe('getBookingStatus', () => {
  it('cancelled by status text', () => {
    expect(getBookingStatus({ status: 'Cancelled', start_date: '2026-05-22', end_date: '2026-05-25' }, TODAY)).toBe('cancelled');
  });

  it('cancelled by cancelled_at', () => {
    expect(getBookingStatus({ cancelled_at: '2026-05-10', start_date: '2026-05-22', end_date: '2026-05-25' }, TODAY)).toBe('cancelled');
  });

  it('upcoming when start_date is in the future', () => {
    expect(getBookingStatus({ start_date: '2026-05-25', end_date: '2026-05-28' }, TODAY)).toBe('upcoming');
  });

  it('checkin_today when start_date == today and !checkin_done', () => {
    expect(getBookingStatus({ start_date: TODAY, end_date: '2026-05-25', checkin_done: false, checkout_done: false }, TODAY)).toBe('checkin_today');
  });

  it('in_progress when checkin_done=true and today between dates', () => {
    expect(getBookingStatus({ start_date: '2026-05-20', end_date: '2026-05-25', checkin_done: true, checkout_done: false }, TODAY)).toBe('in_progress');
  });

  it('checkout_today when end_date == today and !checkout_done', () => {
    expect(getBookingStatus({ start_date: '2026-05-18', end_date: TODAY, checkin_done: true, checkout_done: false }, TODAY)).toBe('checkout_today');
  });

  it('completed when checkout_done=true', () => {
    expect(getBookingStatus({ start_date: '2026-05-18', end_date: TODAY, checkin_done: true, checkout_done: true }, TODAY)).toBe('completed');
  });

  it('past_unverified when end_date < today and !checkout_done', () => {
    expect(getBookingStatus({ start_date: '2026-05-10', end_date: '2026-05-15', checkin_done: true, checkout_done: false }, TODAY)).toBe('past_unverified');
  });

  it('single-day booking starting today without checkin → checkin_today', () => {
    expect(getBookingStatus({ start_date: TODAY, end_date: TODAY, checkin_done: false, checkout_done: false }, TODAY)).toBe('checkin_today');
  });

  it('single-day booking starting today with checkin done → checkout_today', () => {
    expect(getBookingStatus({ start_date: TODAY, end_date: TODAY, checkin_done: true, checkout_done: false }, TODAY)).toBe('checkout_today');
  });

  it('extension: checkout_today → in_progress when end_date moves to future', () => {
    // Reserva que salía hoy se extiende a pasado mañana
    expect(getBookingStatus({ start_date: '2026-05-18', end_date: '2026-05-23', checkin_done: true, checkout_done: false }, TODAY)).toBe('in_progress');
  });

  it('late check-in: start_date in the past but !checkin_done and not finished → checkin_today', () => {
    expect(getBookingStatus({ start_date: '2026-05-19', end_date: '2026-05-25', checkin_done: false, checkout_done: false }, TODAY)).toBe('checkin_today');
  });

  it('cancelled takes precedence over dates', () => {
    expect(getBookingStatus({ status: 'cancelled', start_date: TODAY, end_date: TODAY, checkin_done: false }, TODAY)).toBe('cancelled');
  });

  it('completed (checkout_done) takes precedence over checkout_today', () => {
    expect(getBookingStatus({ start_date: '2026-05-18', end_date: TODAY, checkin_done: true, checkout_done: true }, TODAY)).toBe('completed');
  });
});
