import type { VendorKind, ExpenseCategory, CreditPoolConsumptionRule } from '@/types/database';
import { todayISO } from '@/lib/dateUtils';

export const KINDS: { value: VendorKind; label: string; icon: string; description: string; group: 'utilities' | 'business' }[] = [
  { value: 'utility',          label: 'Servicio público',     icon: '💡', description: 'Luz, agua, gas, internet — gastos de operación de cada propiedad.', group: 'utilities' },
  { value: 'business_service', label: 'Plataforma / SaaS',    icon: '🧰', description: 'Suscripciones de plataformas de administración (Hospitable, Hostfully, esta app), marketing, hosting.', group: 'business' },
  { value: 'admin',            label: 'Administración',       icon: '🏢', description: 'Contador, asesor legal, persona que administra la operación.', group: 'business' },
  { value: 'tax',              label: 'Predial / Impuestos',  icon: '🧾', description: 'Predial, impuestos del rubro, retenciones, cámara de comercio.', group: 'business' },
  { value: 'maintenance',      label: 'Mantenimiento',        icon: '🔧', description: 'Plomero, electricista, carpintería, jardinería.', group: 'business' },
  { value: 'insurance',        label: 'Seguros',              icon: '🛡️', description: 'Pólizas de la propiedad o del negocio.', group: 'business' },
  { value: 'other',            label: 'Otro',                 icon: '📌', description: 'Cualquier otro proveedor recurrente.', group: 'business' },
];

// Tipos visibles al CREAR/EDITAR. Excluye 'utility' (va como recurrente por propiedad)
// y 'cleaner' (va por su propio módulo).
export const KINDS_FORM = KINDS.filter(k => k.group === 'business');

export const kindLabel       = (k: VendorKind) => KINDS.find(x => x.value === k)?.label ?? (k === 'cleaner' ? 'Aseo (legacy)' : k);
export const kindIcon        = (k: VendorKind) => KINDS.find(x => x.value === k)?.icon  ?? '📌';
export const kindDescription = (k: VendorKind) => KINDS.find(x => x.value === k)?.description ?? '';

export const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

export const defaultCategoryFor = (k: VendorKind): ExpenseCategory => {
  if (k === 'utility') return 'Servicios públicos';
  if (k === 'admin') return 'Administración';
  if (k === 'business_service') return 'Administración';
  if (k === 'tax') return 'Administración';
  if (k === 'maintenance') return 'Mantenimiento';
  if (k === 'insurance') return 'Administración';
  return 'Otros';
};

export type PropShare = {
  propertyId: string;
  sharePercent: number | null;
  fixedAmount: number | null;
};

export interface VendorForm {
  name: string;
  kind: VendorKind;
  category: ExpenseCategory;
  defaultAmount: string;
  dayOfMonth: string;
  startYearMonth: string;
  isVariable: boolean;
  contact: string;
  notes: string;
  active: boolean;
  props: PropShare[];
  poolEnabled: boolean;
  poolCreditsTotal: string;
  poolConsumptionRule: CreditPoolConsumptionRule;
  poolCreditsPerUnit: string;
  poolChildWeight: string;
  poolActivatedAt: string;
  poolExpiresAt: string;
}

export const EMPTY_VENDOR_FORM: VendorForm = {
  name: '', kind: 'business_service', category: 'Administración',
  defaultAmount: '', dayOfMonth: '', startYearMonth: '', isVariable: false,
  contact: '', notes: '', active: true, props: [],
  poolEnabled: false,
  poolCreditsTotal: '',
  poolConsumptionRule: 'per_person_per_night',
  poolCreditsPerUnit: '1',
  poolChildWeight: '1',
  poolActivatedAt: todayISO(),
  poolExpiresAt: '',
};
