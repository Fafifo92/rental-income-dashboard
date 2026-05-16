/**
 * expenseGrouping.ts
 *
 * Utilities to collapse expenses that share the same `expense_group_id`
 * into a single "group header" row, optionally followed by individual
 * child rows when the user expands the group.
 *
 * Rules:
 *  - Expenses WITHOUT expense_group_id → kept as-is in the output array.
 *  - Expenses WITH expense_group_id    → first encounter emits a group
 *    header row (isGroup=true, amount=sum of all members).  Subsequent
 *    members of the same group are skipped unless `expandedGroups` contains
 *    that group id, in which case child rows (isChild=true) are inserted
 *    right after the header.
 *
 * Date ordering is preserved: the position of a group in the result list
 * corresponds to the position of its first encountered member.
 */

import type { Expense, GroupedExpense } from '@/types';

export function groupExpenses(
  expenses: Expense[],
  expandedGroups: ReadonlySet<string> = new Set(),
): GroupedExpense[] {
  // Pre-compute per-group data in one pass
  const groupMap = new Map<string, Expense[]>();
  for (const exp of expenses) {
    if (exp.expense_group_id) {
      const bucket = groupMap.get(exp.expense_group_id) ?? [];
      bucket.push(exp);
      groupMap.set(exp.expense_group_id, bucket);
    }
  }

  // Build flat output preserving original ordering
  const result: GroupedExpense[] = [];
  const seenGroupIds = new Set<string>();

  for (const exp of expenses) {
    if (!exp.expense_group_id) {
      // Plain (ungrouped) expense – pass through as-is
      result.push(exp as GroupedExpense);
      continue;
    }

    const gid = exp.expense_group_id;

    if (seenGroupIds.has(gid)) {
      // Already emitted the header for this group; skip repeated members
      // (children are added below when the group is expanded)
      continue;
    }

    seenGroupIds.add(gid);

    const members = groupMap.get(gid) ?? [exp];
    const groupTotal = members.reduce((sum, e) => sum + e.amount, 0);

    // For cleaning payouts, groupSize = unique bookings (not expense count,
    // since each booking can generate 2 expenses: fee + supplies).
    // Detect by subcategory OR category name to handle loose expenses that
    // may not have subcategory='cleaning' set.
    const isCleaningMember = (m: Expense) =>
      m.subcategory === 'cleaning' || m.category === 'Aseo' || m.category === 'Insumos de aseo';
    const isCleaningPayout = members.some(isCleaningMember);
    const groupSize = isCleaningPayout
      ? Math.max(new Set(members.map(m => m.booking_id).filter(Boolean)).size, 1)
      : members.length;

    // Use consensus bank_account_id: pick from the first member that has one
    // (the first member in array order may have null if it hasn't been paid yet,
    // while other members already have the account set).
    const consensusBankAccountId =
      members.find(m => m.bank_account_id != null)?.bank_account_id ?? null;

    // Group header row – use the representative (first-encountered) expense
    // for descriptive fields, but replace amount with the group total and
    // derive bank_account_id from any member that has it.
    result.push({
      ...exp,
      bank_account_id: consensusBankAccountId,
      amount: groupTotal,
      isGroup: true,
      groupTotal,
      groupSize,
      children: members,
    });

    // Inject child rows when the group is expanded
    if (expandedGroups.has(gid)) {
      for (const child of members) {
        result.push({
          ...child,
          isChild: true,
          parentGroupId: gid,
        });
      }
    }
  }

  return result;
}

/**
 * Produce a flat expense list suitable for export (PDF / CSV / Excel).
 * Each group becomes one "summary" row; no interactive expansion.
 */
export function flattenExpensesForExport(expenses: Expense[]): Array<Expense & { _isGroupHeader?: boolean; _groupSize?: number }> {
  const groupMap = new Map<string, Expense[]>();
  for (const exp of expenses) {
    if (exp.expense_group_id) {
      const bucket = groupMap.get(exp.expense_group_id) ?? [];
      bucket.push(exp);
      groupMap.set(exp.expense_group_id, bucket);
    }
  }

  const result: Array<Expense & { _isGroupHeader?: boolean; _groupSize?: number }> = [];
  const seen = new Set<string>();

  for (const exp of expenses) {
    if (!exp.expense_group_id) {
      result.push(exp);
      continue;
    }
    if (seen.has(exp.expense_group_id)) continue;
    seen.add(exp.expense_group_id);

    const members = groupMap.get(exp.expense_group_id) ?? [exp];
    const total = members.reduce((s, e) => s + e.amount, 0);
    result.push({
      ...exp,
      amount: total,
      property_id: null, // no single property — listed as group
      _isGroupHeader: true,
      _groupSize: members.length,
    });
  }

  return result;
}
