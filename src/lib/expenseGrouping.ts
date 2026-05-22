/**
 * expenseGrouping.ts
 *
 * Utilities to collapse expenses that belong together into a single
 * "group header" row, optionally followed by individual child rows when
 * the user expands the group.
 *
 * Grouping keys (in priority order):
 *  1. `expense_group_id` — explicit grouping (manual shared expenses,
 *     damages, cleaning payouts).
 *  2. `shared_bill_id`   — vendor payments distributed across multiple
 *     properties via a SharedBill. Header amount = sum of all members.
 *  3. `vendor_id + year-month` — virtual grouping: catches vendor payments
 *     that were registered separately (no shared_bill_id, or each with a
 *     different shared_bill_id) but share the same vendor and billing month.
 *  4. `vendor (text) + category + year-month` — virtual grouping for expenses
 *     whose vendor was typed as plain text (no vendor_id FK), e.g. EMDUPAR
 *     utilities registered manually per property.
 *
 * Rules:
 *  - Expenses with no applicable key → kept as-is in the output array.
 *  - First encounter of a group emits a header (isGroup=true, amount=sum
 *    of members). Subsequent members are skipped unless `expandedGroups`
 *    contains that group key, in which case child rows (isChild=true)
 *    are inserted right after the header.
 *  - Shared-bill / virtual-vendor groups with a single member fall through
 *    as ungrouped rows to avoid badge clutter.
 *
 * Date ordering is preserved: the position of a group in the result list
 * corresponds to the position of its first encountered member.
 */

import type { Expense, GroupedExpense } from '@/types';

/** Effective group key for an expense (priority order):
 *  1. explicit `expense_group_id`
 *  2. `shared_bill_id` (vendor payments created via SharedBill flow)
 *  3. `vd:{vendor_id}:{year-month}` (virtual by FK vendor: same vendor_id, same month)
 *  4. `vt:{vendor_text}:{category}:{year-month}` (virtual by text vendor: manually-entered
 *     vendor name with no vendor_id — catches utility/admin expenses registered per property)
 *  Returns null when the expense should be displayed as an ungrouped row.
 */
function effectiveGroupKey(e: Expense): { key: string; isSharedBill: boolean; isVirtual: boolean } | null {
  if (e.expense_group_id) return { key: e.expense_group_id, isSharedBill: false, isVirtual: false };
  if (e.shared_bill_id)   return { key: `sb:${e.shared_bill_id}`, isSharedBill: true, isVirtual: false };
  if (e.vendor_id)        return { key: `vd:${e.vendor_id}:${e.date.substring(0, 7)}`, isSharedBill: false, isVirtual: true };
  // Tier-4: vendor entered as plain text (no FK). Group by normalized vendor name + category + month.
  if (e.vendor) {
    const vendorKey = e.vendor.trim().toLowerCase();
    return { key: `vt:${vendorKey}:${e.category}:${e.date.substring(0, 7)}`, isSharedBill: false, isVirtual: true };
  }
  return null;
}

export function groupExpenses(
  expenses: Expense[],
  expandedGroups: ReadonlySet<string> = new Set(),
): GroupedExpense[] {
  // Pre-compute per-group data in one pass
  const groupMap = new Map<string, Expense[]>();
  const groupKindMap = new Map<string, { isSharedBill: boolean; isVirtual: boolean }>();
  for (const exp of expenses) {
    const eg = effectiveGroupKey(exp);
    if (eg) {
      const bucket = groupMap.get(eg.key) ?? [];
      bucket.push(exp);
      groupMap.set(eg.key, bucket);
      groupKindMap.set(eg.key, { isSharedBill: eg.isSharedBill, isVirtual: eg.isVirtual });
    }
  }

  // Build flat output preserving original ordering
  const result: GroupedExpense[] = [];
  const seenGroupIds = new Set<string>();

  for (const exp of expenses) {
    const eg = effectiveGroupKey(exp);
    if (!eg) {
      // Plain (ungrouped) expense – pass through as-is
      result.push(exp as GroupedExpense);
      continue;
    }

    const gid = eg.key;

    if (seenGroupIds.has(gid)) {
      // Already emitted the header for this group; skip repeated members
      // (children are added below when the group is expanded)
      continue;
    }

    seenGroupIds.add(gid);

    const members = groupMap.get(gid) ?? [exp];
    // Shared-bill / virtual-vendor "groups" of a single expense fall through
    // as regular rows to avoid badge clutter.
    if ((eg.isSharedBill || eg.isVirtual) && members.length < 2) {
      result.push(exp as GroupedExpense);
      continue;
    }

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
      _groupKey: gid,
      _isSharedBillGroup: eg.isSharedBill,
      _isVirtualVendorGroup: eg.isVirtual,
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
 *
 * Group headers include `_members` (the individual property-level expenses
 * that make up the group) so the exporter can render a child sub-row per
 * property without re-computing grouping. Works for all 4 grouping tiers.
 */
export type FlatExportRow = Expense & {
  _isGroupHeader?: boolean;
  _groupSize?: number;
  _groupKey?: string;
  _members?: Expense[];
  _isSharedBillGroup?: boolean;
  _isVirtualVendorGroup?: boolean;
};

export function flattenExpensesForExport(expenses: Expense[]): FlatExportRow[] {
  const groupMap = new Map<string, Expense[]>();
  const groupKindMap = new Map<string, { isSharedBill: boolean; isVirtual: boolean }>();
  for (const exp of expenses) {
    const eg = effectiveGroupKey(exp);
    if (eg) {
      const bucket = groupMap.get(eg.key) ?? [];
      bucket.push(exp);
      groupMap.set(eg.key, bucket);
      groupKindMap.set(eg.key, { isSharedBill: eg.isSharedBill, isVirtual: eg.isVirtual });
    }
  }

  const result: FlatExportRow[] = [];
  const seen = new Set<string>();

  for (const exp of expenses) {
    const eg = effectiveGroupKey(exp);
    if (!eg) {
      result.push(exp);
      continue;
    }
    if (seen.has(eg.key)) continue;
    seen.add(eg.key);

    const members = groupMap.get(eg.key) ?? [exp];
    if ((eg.isSharedBill || eg.isVirtual) && members.length < 2) {
      result.push(exp);
      continue;
    }
    const total = members.reduce((s, e) => s + e.amount, 0);
    result.push({
      ...exp,
      amount: total,
      property_id: null, // no single property — listed as group
      _isGroupHeader: true,
      _groupSize: members.length,
      _groupKey: eg.key,
      _members: members,
      _isSharedBillGroup: eg.isSharedBill,
      _isVirtualVendorGroup: eg.isVirtual,
    });
  }

  return result;
}
