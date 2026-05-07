import { AnimatePresence } from 'framer-motion';
import ExpenseTypeChooser, { type ExpenseTypeChoice } from '../ExpenseTypeChooser';
import DamageFromExpensesFlow from '../DamageFromExpensesFlow';
import PropertyExpenseForm from '../expense-forms/PropertyExpenseForm';
import CleaningSuppliesForm from '../expense-forms/CleaningSuppliesForm';
import VendorExpenseForm from '../expense-forms/VendorExpenseForm';
import InventoryMaintenanceExpenseForm from '../expense-forms/InventoryMaintenanceExpenseForm';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, MaintenanceScheduleRow } from '@/types/database';

export interface ExpenseFormFlags {
  showChooser: boolean;
  showDamageFlow: boolean;
  showPropertyForm: boolean;
  showSuppliesForm: boolean;
  showVendorForm: boolean;
  showInventoryMaintenanceForm: boolean;
  invMaintPrefillSchedule: MaintenanceScheduleRow | null;
  defaultPropertyId: string | null;
}

export interface ExpenseFormHandlers {
  onChooserChoose: (choice: ExpenseTypeChoice) => void;
  closeChooser: () => void;
  closeDamageFlow: () => void;
  onDamageSaved: () => void;
  closePropertyForm: () => void;
  closeSuppliesForm: () => void;
  closeVendorForm: () => void;
  closeInventoryMaintenanceForm: () => void;
  onSave: (data: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean>;
  onSaveShared: (rows: Omit<Expense, 'id' | 'owner_id'>[]) => Promise<boolean>;
  onSaveInventoryMaintenance: (data: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean>;
}

interface Props {
  flags: ExpenseFormFlags;
  handlers: ExpenseFormHandlers;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  saveError: string;
}

/**
 * Pila de modales de creación de gastos: chooser + 5 formularios dedicados.
 * Stateless — recibe flags y handlers; no toca contexto de gasto en edición.
 */
export default function ExpensesFormsModals({ flags, handlers, properties, bankAccounts, saveError }: Props) {
  return (
    <AnimatePresence>
      {flags.showChooser && (
        <ExpenseTypeChooser onChoose={handlers.onChooserChoose} onClose={handlers.closeChooser} />
      )}

      {flags.showDamageFlow && (
        <DamageFromExpensesFlow
          properties={properties}
          onClose={handlers.closeDamageFlow}
          onSaved={handlers.onDamageSaved}
        />
      )}

      {flags.showPropertyForm && (
        <PropertyExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          error={saveError || undefined}
          onClose={handlers.closePropertyForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closePropertyForm(); }}
          onSaveShared={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closePropertyForm(); }}
        />
      )}

      {flags.showSuppliesForm && (
        <CleaningSuppliesForm
          properties={properties}
          bankAccounts={bankAccounts}
          error={saveError || undefined}
          onClose={handlers.closeSuppliesForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closeSuppliesForm(); }}
          onSaveShared={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closeSuppliesForm(); }}
        />
      )}

      {flags.showVendorForm && (
        <VendorExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          error={saveError || undefined}
          onClose={handlers.closeVendorForm}
          onSave={async (data) => { const ok = await handlers.onSave(data); if (ok) handlers.closeVendorForm(); }}
          onSaveMultiple={async (rows) => { const ok = await handlers.onSaveShared(rows); if (ok) handlers.closeVendorForm(); }}
        />
      )}

      {flags.showInventoryMaintenanceForm && (
        <InventoryMaintenanceExpenseForm
          properties={properties}
          bankAccounts={bankAccounts}
          linkedSchedule={flags.invMaintPrefillSchedule}
          defaultPropertyId={flags.defaultPropertyId}
          error={saveError || undefined}
          onClose={handlers.closeInventoryMaintenanceForm}
          onSave={handlers.onSaveInventoryMaintenance}
        />
      )}
    </AnimatePresence>
  );
}
