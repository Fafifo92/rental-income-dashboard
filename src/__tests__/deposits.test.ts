import { describe, it, expect } from 'vitest';
import { computeDepositBalance } from '@/lib/depositMath';

describe('computeDepositBalance', () => {
  it('returns zeros when no deposit', () => {
    const b = computeDepositBalance(0, []);
    expect(b.security_deposit).toBe(0);
    expect(b.available).toBe(0);
    expect(b.resolved).toBe(0);
  });

  it('returns full available when received but no applications', () => {
    const b = computeDepositBalance(500_000, []);
    expect(b.security_deposit).toBe(500_000);
    expect(b.available).toBe(500_000);
    expect(b.resolved).toBe(0);
  });

  it('subtracts applied_to_damage', () => {
    const b = computeDepositBalance(500_000, [
      { kind: 'applied_to_damage', amount: 200_000 },
    ]);
    expect(b.applied_amount).toBe(200_000);
    expect(b.available).toBe(300_000);
    expect(b.resolved).toBe(200_000);
  });

  it('handles mixed applications', () => {
    const b = computeDepositBalance(500_000, [
      { kind: 'applied_to_damage', amount: 100_000 },
      { kind: 'returned_to_guest', amount: 200_000 },
      { kind: 'surplus_to_income', amount: 50_000 },
    ]);
    expect(b.applied_amount).toBe(100_000);
    expect(b.returned_amount).toBe(200_000);
    expect(b.surplus_amount).toBe(50_000);
    expect(b.resolved).toBe(350_000);
    expect(b.available).toBe(150_000);
  });

  it('clamps available at zero (never negative)', () => {
    const b = computeDepositBalance(100_000, [
      { kind: 'applied_to_damage', amount: 150_000 },
    ]);
    expect(b.available).toBe(0);
  });

  it('treats null security_deposit as zero', () => {
    const b = computeDepositBalance(null, [
      { kind: 'returned_to_guest', amount: 0 },
    ]);
    expect(b.security_deposit).toBe(0);
    expect(b.available).toBe(0);
  });

  it('ignores zero / non-numeric amounts gracefully', () => {
    const b = computeDepositBalance(300_000, [
      { kind: 'applied_to_damage', amount: 0 },
      // @ts-expect-error testing runtime resilience
      { kind: 'applied_to_damage', amount: 'abc' },
      { kind: 'returned_to_guest', amount: 100_000 },
    ]);
    expect(b.applied_amount).toBe(0);
    expect(b.returned_amount).toBe(100_000);
    expect(b.available).toBe(200_000);
  });
});
