# STR Analytics — Rental Income Dashboard

A full-stack **Short-Term Rental (STR) management platform** built for Colombian property owners. It tracks bookings, income, expenses, cleanings, inventory, security deposits, and generates P&L reports — all in a single SaaS-style web app backed by Supabase.

---

## Table of Contents

1. [Purpose & Context](#purpose--context)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Project Structure](#project-structure)
5. [Core Domain Model](#core-domain-model)
6. [Features & Modules](#features--modules)
7. [Financial Model](#financial-model)
8. [Database & Migrations](#database--migrations)
9. [Service Layer](#service-layer)
10. [Frontend Architecture](#frontend-architecture)
11. [Authentication & Security](#authentication--security)
12. [ETL & CSV Import](#etl--csv-import)
13. [Data Integrity & Audit](#data-integrity--audit)
14. [Getting Started](#getting-started)
15. [Environment Variables](#environment-variables)
16. [Testing](#testing)
17. [Linting & Formatting](#linting--formatting)

---

## Purpose & Context

**STR Analytics** is designed for hosts managing one or more short-term rental properties (apartments, suites) on platforms like Airbnb, Booking.com, and direct bookings — primarily in Colombia. The system replaces manual spreadsheets with a structured, multi-tenant platform that provides:

- Accurate **P&L statements** per property and across the portfolio.
- Full **booking lifecycle** management: import from CSV/Excel → check-in → check-out → payout.
- **Expense tracking** with variable vs fixed classification, vendor assignment, and bank account reconciliation.
- **Security deposit lifecycle**: received → applied to damage / returned to guest / surplus to income.
- **Operational dashboards**: occupancy rates, ADR, RevPAR, break-even analysis.
- **Cleaning & vendor management**: cleaner assignment, fee tracking, shared bills.
- **Inventory control**: per-property item catalogue, damage reports, end-of-life scheduling.
- **Credit pools**: prepaid service packages (e.g. insurance nights) with FIFO consumption per booking.
- **Notification system** with configurable reminders for pending recurring expenses, maintenance, and more.

The app is localised in **Spanish** and uses **COP (Colombian Pesos)** as default currency, with multi-currency support via exchange rates.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Astro 6](https://astro.build) — islands architecture (static shell + React islands) |
| **UI Components** | [React 18](https://react.dev) (client-side islands via `@astrojs/react`) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com) (via `@tailwindcss/vite` plugin) |
| **Animation** | [Framer Motion 12](https://www.framer.com/motion/) |
| **Charts** | [Recharts 3](https://recharts.org) |
| **Tables** | [TanStack Table 8](https://tanstack.com/table) |
| **Backend / DB** | [Supabase](https://supabase.com) (PostgreSQL + Auth + RLS + Edge Functions) |
| **Supabase Client** | `@supabase/supabase-js` v2 with full TypeScript generics |
| **Date handling** | [date-fns 4](https://date-fns.org) |
| **CSV parsing** | [PapaParse 5](https://www.papaparse.com) |
| **Excel parsing** | [read-excel-file 5](https://www.npmjs.com/package/read-excel-file) |
| **Toasts** | [react-hot-toast 2](https://react-hot-toast.com) |
| **Icons** | [Lucide React](https://lucide.dev) |
| **Type-checking** | TypeScript 5 (strict) |
| **Testing** | [Vitest 2](https://vitest.dev) |
| **Linting** | ESLint 10 + `@typescript-eslint` + `eslint-plugin-react` + `jsx-a11y` |
| **Formatting** | Prettier 3 |
| **Build** | Vite (via Astro) |

---

## Architecture

The app follows **Astro's Islands Architecture**: the HTML shell is rendered server-side (or statically), and interactive regions are hydrated as isolated React "islands" on the client. This gives excellent initial load performance while keeping full React interactivity where needed.

```
Browser
  └── Astro page (.astro)           ← Static HTML shell, navigation, layout
        └── React Island (client:idle / client:load)
              └── Feature Component (e.g. DashboardClient)
                    └── Custom Hooks  (useDashboardData, useReferenceData, …)
                          └── Service Functions (financial.ts, bookings.ts, …)
                                └── Supabase JS Client → PostgreSQL (Supabase)
```

### Key Architectural Decisions

- **`client:idle`** hydration strategy is used for heavy dashboard components so they load after the browser is idle, improving perceived performance.
- **`client:load`** is used for lightweight components that need to be immediately interactive (e.g. `NotificationsBell`, `NavActions`).
- **No server-side rendering of data**: all data fetching happens in the React islands via async service calls to Supabase's PostgREST API. Astro pages are thin wrappers around components.
- **Service layer** (`src/services/`) provides a clean boundary between UI and data access — all Supabase calls are isolated there. Services return `ServiceResult<T>` (`{ data, error }`) so the UI always handles both states.
- **Pure computation** is isolated in `src/lib/` (e.g. `depositMath.ts`, `creditPoolCalc.ts`, `bookingStatus.ts`) so it can be unit-tested without Supabase credentials.
- **Typed database schema** in `src/types/database.ts` mirrors every Supabase table exactly — no `any` allowed — enabling full end-to-end type safety.

---

## Project Structure

```
rental-income-dashboard/
├── src/
│   ├── components/
│   │   ├── Nav.astro                  # Responsive navigation with mobile drawer
│   │   ├── MoneyInput.tsx             # Currency input component
│   │   ├── PropertyMultiSelectFilter.tsx
│   │   └── features/                  # All feature-specific React components
│   │       ├── DashboardClient.tsx    # Main dashboard island
│   │       ├── BookingsClient.tsx     # Bookings management
│   │       ├── ExpensesClient.tsx     # Expense management
│   │       ├── PropertiesClient.tsx   # Property & listing management
│   │       ├── InventoryClient.tsx    # Inventory catalogue
│   │       ├── BankAccountsClient.tsx # Bank accounts & balances
│   │       ├── VendorsClient.tsx      # Vendors & services
│   │       ├── AseoClient.tsx         # Cleaning staff management
│   │       ├── CreditPoolsClient.tsx  # Credit pool management
│   │       ├── PrintReport.tsx        # Printable financial report
│   │       ├── FinancialLedger.tsx    # Transaction ledger table
│   │       ├── DataTable.tsx          # Reusable TanStack Table wrapper
│   │       ├── deposits/              # Security deposit lifecycle UI
│   │       ├── bookings/              # Booking-specific sub-components
│   │       ├── expenses/              # Expense forms & panels
│   │       ├── properties/            # Property cards & modals
│   │       ├── inventory/             # Inventory views & modals
│   │       ├── aseo/                  # Cleaning detail modals
│   │       ├── vendors/               # Vendor sub-components
│   │       └── data-issues/           # Data integrity UI
│   ├── layouts/
│   │   └── Layout.astro               # HTML shell, meta tags, global styles
│   ├── lib/
│   │   ├── supabase/client.ts         # Typed Supabase client singleton
│   │   ├── bookingStatus.ts           # Derived booking state machine
│   │   ├── creditPoolCalc.ts          # Credit pool FIFO consumption math
│   │   ├── dateUtils.ts               # Date helpers
│   │   ├── depositMath.ts             # Pure deposit balance calculations
│   │   ├── expenseClassify.ts         # Strategy-pattern expense classifier
│   │   ├── expenseClassifyRules.ts    # Classification rule registry
│   │   ├── expenseGrouping.ts         # Grouping helpers
│   │   ├── money.ts                   # Safe money arithmetic utilities
│   │   ├── toast.ts                   # Toast notification helpers
│   │   ├── useAuth.ts                 # Auth state hook
│   │   ├── useBackdropClose.ts        # Modal close on backdrop click
│   │   ├── usePropertyFilter.ts       # Cross-page property filter
│   │   ├── damageDescription.ts       # Damage report label helpers
│   │   └── hooks/
│   │       ├── useDashboardData.ts    # Dashboard data fetching hook
│   │       ├── useExpensesList.ts     # Expenses list hook
│   │       ├── useBookingsList.ts     # Bookings list hook
│   │       └── useReferenceData.ts    # Static reference data hook
│   ├── pages/                         # Astro page routes
│   │   ├── index.astro                # → redirect to /login
│   │   ├── login.astro                # Login page
│   │   ├── dashboard.astro            # Main dashboard
│   │   ├── bookings.astro             # Bookings management
│   │   ├── expenses.astro             # Expense tracking
│   │   ├── properties.astro           # Property portfolio
│   │   ├── property-detail.astro      # Single property detail
│   │   ├── inventory.astro            # Inventory management
│   │   ├── accounts.astro             # Bank accounts
│   │   ├── vendors.astro              # Vendors & providers
│   │   ├── services-admin.astro       # Services calendar matrix
│   │   ├── aseo.astro                 # Cleaning management
│   │   ├── credit-pools.astro         # Credit pool management
│   │   ├── notificaciones.astro       # Notification settings
│   │   ├── report.astro               # Printable financial report
│   │   └── data-issues.astro          # Data integrity dashboard
│   ├── services/                      # All Supabase data access
│   │   ├── auth.ts                    # Authentication
│   │   ├── bookings.ts                # Bookings CRUD + import
│   │   ├── expenses.ts                # Expenses CRUD
│   │   ├── financial.ts               # KPI computation engine
│   │   ├── transactions.ts            # Financial transaction ledger
│   │   ├── deposits.ts                # Security deposit lifecycle
│   │   ├── properties.ts              # Properties & listings
│   │   ├── inventory.ts               # Inventory management
│   │   ├── bankAccounts.ts            # Bank accounts
│   │   ├── vendors.ts                 # Vendor CRUD
│   │   ├── cleanings.ts               # Cleaning records
│   │   ├── creditPools.ts             # Credit pools + FIFO consumption
│   │   ├── recurringExpenses.ts       # Recurring expense templates
│   │   ├── recurringPeriods.ts        # Monthly recurring period tracking
│   │   ├── bookingAdjustments.ts      # Booking adjustments (damage charges, extras)
│   │   ├── sharedBills.ts             # Shared vendor bills
│   │   ├── dataIssues.ts              # Data health checks via RPC
│   │   ├── export.ts                  # CSV/Excel export utilities
│   │   ├── etl.ts                     # CSV/Excel import & parsing
│   │   ├── notificationSettings.ts    # User notification prefs
│   │   └── …                          # (listings, propertyGroups, propertyTags, …)
│   ├── styles/                        # Global CSS
│   └── types/
│       ├── database.ts                # Full typed mirror of PostgreSQL schema
│       └── index.ts                   # Shared domain types (Expense, etc.)
├── supabase/                          # Database migrations (55+)
│   ├── schema.sql                     # Base schema
│   ├── schema_consolidated.sql        # Consolidated schema snapshot
│   ├── migration_001_*.sql … migration_055_*.sql
│   └── functions/                     # Supabase Edge Functions / RPC definitions
├── astro.config.mjs                   # Astro + Vite configuration
├── tsconfig.json                      # TypeScript config (strict mode)
├── vitest.config.ts                   # Vitest test runner config
├── eslint.config.mjs                  # ESLint flat config
└── package.json
```

---

## Core Domain Model

The data model is multi-tenant: every row is scoped to `owner_id` (the authenticated Supabase user), enforced by Row Level Security policies.

```
profiles                  — User profile (name, email, role)
  │
  ├── properties           — Physical rental properties (address, bedrooms, RNT)
  │     ├── listings       — Platform-specific listings (Airbnb, Booking.com, etc.)
  │     │     └── bookings — Guest reservations
  │     │           ├── booking_payments       — Partial/full payments received
  │     │           ├── booking_adjustments    — Extra charges / discounts / damage fees
  │     │           ├── booking_cleanings      — Cleaning records per turn
  │     │           └── booking_deposit_applications  — Security deposit lifecycle
  │     ├── expenses       — All expenses (fixed + variable), linked to property or booking
  │     ├── property_recurring_expenses  — Recurring expense templates
  │     ├── recurring_expense_periods    — Monthly period instances of recurring expenses
  │     └── inventory_items              — Physical inventory items per property
  │           ├── inventory_categories
  │           ├── inventory_movements    — Stock in/out/damage events
  │           └── inventory_maintenance_schedules
  │
  ├── bank_accounts         — Owner's bank accounts (ahorros, corriente, billetera, crédito)
  │     └── account_deposits — Manual deposits into accounts
  │
  ├── vendors               — Service providers (cleaners, utilities, insurance, etc.)
  │     ├── vendor_properties — Vendor ↔ property M:M with share/amount
  │     └── shared_bills      — Monthly vendor invoice, split across properties
  │
  ├── cleaner_groups        — Groups of cleaners (tags)
  │     └── cleaner_group_members
  │
  ├── credit_pools          — Prepaid service packages (insurance nights, etc.)
  │     ├── credit_pool_consumptions  — FIFO consumption records per booking
  │     └── credit_pool_properties   — Property scoping for pools without a vendor
  │
  ├── property_groups       — Visual grouping of properties
  ├── property_tags         — Tagging system for properties
  ├── property_tag_assignments
  │
  ├── user_notification_settings  — Per-user reminder configuration
  └── audit_log             — Append-only audit trail (SECURITY DEFINER trigger)
```

### Key Relationships

- A **property** has one or more **listings** (one per OTA channel). A **booking** always belongs to a listing, not directly to a property.
- **Expenses** can be scoped to a **property** (fixed/variable property costs) or directly to a **booking** (cleaning, damage, guest amenities).
- **Booking adjustments** represent modifications to the original booking revenue: extra income, discounts, damage charges, platform refunds, or extra guest fees.
- **Recurring expenses** have a template row (`property_recurring_expenses`) and monthly instance rows (`recurring_expense_periods`). The UI shows pending periods that haven't been paid yet.
- **Shared bills** are a vendor invoice for a given month, automatically split into per-property expense rows according to `vendor_properties.share_percent` or `fixed_amount`.

---

## Features & Modules

### 📊 Dashboard (`/dashboard`)

The main overview page. Renders after authentication with:

- **KPI Summary cards**: Gross Revenue, Net Profit, Occupancy Rate, ADR (Average Daily Rate), RevPAR.
- **P&L Waterfall panel**: Booking revenue → Gross Revenue → Variable Expenses → Contribution Margin → Fixed Expenses → Net Profit. Each row animates in with Framer Motion.
- **Revenue & Occupancy charts** (Recharts): configurable by `day / week / month` granularity, auto-inferred from period length.
- **Period selector**: Current Month, Last 3 Months, This Year, All Time, or Custom range.
- **Multi-property filter**: toggle individual properties to narrow KPIs and charts.
- **Break-even analysis**: minimum occupancy needed to cover fixed costs.
- **Payout breakdown**: confirmed received vs expected from future bookings.
- **Active bookings widget**: today's check-ins/check-outs and in-progress stays.
- **Pending panels**: recurring expenses due, shared bills pending payment, alerts.
- **Ingresos vs Egresos tab**: full financial transaction ledger with bank account reconciliation, CSV export.

**Demo mode**: If not authenticated, the dashboard renders with realistic seed data (two Medellín properties: "Apto El Poblado 204" and "Suite Laureles 301") so anyone can explore without credentials.

### 📅 Bookings (`/bookings`)

Full booking management:

- **Import from CSV or Excel** (Airbnb/Booking.com formats). The ETL parser handles multiple date and currency formats including Colombian peso notation (`1.520.000`).
- **Manual booking creation** via form modal.
- **Conflict detection & resolution**: overlapping bookings are flagged and can be resolved interactively.
- **Duplicate detection**: same confirmation code from multiple imports.
- **Booking detail modal**: full timeline — guest info, dates, revenue, payout, adjustments, cleaning, security deposit ledger.
- **Payout modal**: register bank account and date of actual payout from OTA.
- **Derived status chip**: `Próxima / Check-in hoy / En curso / Check-out hoy / Completada / Sin verificar / Cancelada` — computed from dates and operational flags, never stored as raw text.
- **Filterable table**: by property, status, channel, date range, guest name, confirmation code.
- **KPI cards**: total bookings, revenue, nights, ADR, completions, cancellations.
- **Export modal**: CSV / Excel export with configurable columns.
- **Accordion view**: bookings grouped by derived status.

### 💸 Expenses (`/expenses`)

Comprehensive expense tracking:

- **Taxonomy (Phase 16)**: expenses are classified in a 4+3 taxonomy:
  - *Property expenses*: Utilities (`utilities`), Administration (`administration`), Maintenance (`maintenance`), Stock & Inventory (`stock`)
  - *Booking expenses*: Cleaning (`cleaning`), Guest Damages (`damage`), Guest Amenities (`guest_amenities`), Cancellation Fines (`penalty`)
- **Auto-classification engine** (`expenseClassify.ts`): strategy-pattern rule registry that maps legacy free-text categories and subcategories to the canonical taxonomy. Rules are ordered by priority and can be extended without modifying the core classifier.
- **Fixed vs Variable**: fixed expenses are those that occur regardless of occupancy; variable expenses are per-booking.
- **Expense groups**: related expenses can be linked into a group (e.g. one maintenance job with multiple line items).
- **Recurring expenses**: templates with monthly period tracking. Pending periods appear in dashboard alert panels.
- **Shared bills**: a vendor invoice that gets split automatically across properties.
- **Pending payables panel**: expenses in `pending` or `partial` status.
- **Maintenance panel**: scheduled maintenance items with recurrence.
- **Bank account assignment**: every paid expense must reference a bank account for reconciliation.
- **Export to CSV**.

### 🏠 Properties (`/properties`, `/property-detail`)

- Create, edit, and delete properties with address, bedrooms, max guests, estrato, and RNT (Registro Nacional de Turismo).
- Assign to **property groups** (visual colour-coded categories) and **tags** (flexible labels).
- Manage **listings** per property: link an OTA listing name to the property so imported bookings auto-map.
- **Listing Mapper**: interactive flow to resolve unmapped listings from imported CSV files.
- **Property detail page**: shows all bookings, expenses, KPIs, and inventory for a single property.

### 📦 Inventory (`/inventory`)

- **Item catalogue**: physical items catalogued per property with category, purchase price, current status, and notes.
- **Categories**: Furniture, Appliances, Utensils, Linen, Decoration, Other (auto-seeded on first use).
- **Movement log**: stock in, stock out, and damage events.
- **Damage reconciliation**: link inventory damage to a booking and a damage expense for full traceability.
- **Maintenance schedules**: plan periodic maintenance with recurrence (annual, bi-annual, etc.).
- **End-of-life tracking**: items with scheduled replacement dates.
- **KPI panel**: total inventory value, items needing attention, upcoming maintenance.

### 🏦 Bank Accounts (`/accounts`)

- Manage the owner's bank accounts: `ahorros`, `corriente`, `billetera`, `crédito`, `otro`.
- Special **cash account** (always present, cannot be deleted).
- **Credit accounts** with credit limit tracking.
- **Account deposits**: record manual cash/transfer deposits separate from booking payouts.
- **Virtual deposit ledger**: a derived view showing how much security deposit money is held per bank account (not a real account, just a virtual ledger aggregated from `booking_deposit_applications`).
- Balance computed from: opening balance + deposits + booking payouts − paid expenses.

### 🧾 Vendors & Services (`/vendors`, `/services-admin`)

- **Vendor registry**: service providers categorised as `utility`, `admin`, `business_service`, `maintenance`, `cleaner`, `insurance`, `tax`, `other`.
- **Vendor ↔ Property matrix**: assign a vendor to one or more properties with a share percentage or fixed amount.
- **Shared bills**: enter a vendor's monthly invoice total and the system auto-splits it into individual expense rows per property according to the configured shares.
- **Services admin calendar**: month-by-month matrix showing which services have been paid vs pending across all properties.

### 🧹 Aseo / Cleaning (`/aseo`)

- Manage cleaning staff (vendors of kind `cleaner`) and **cleaner groups** (colour-coded tags).
- Per-booking cleaning records: assign cleaner, fee, supplies amount, done/paid status.
- **Payout modal**: mark cleanings as paid and record the bank account used.
- Pending cleanings summary dashboard.

### 🏊 Credit Pools (`/credit-pools`)

A credit pool models a prepaid service pack — for example, 10 insurance nights purchased for $500,000:

- **FIFO consumption**: when a new booking's check-in date falls within the pool's activation period and the property is covered, the pool auto-consumes credits. The oldest active pool is consumed first. If a pool runs out mid-booking, the remainder spills to the next pool.
- **Unit pricing snapshot**: `unit_price_snapshot` is frozen at consumption time, protecting historical reports from price changes.
- **Property scoping**: pools can be scoped to a vendor's property list or to an explicit `credit_pool_properties` list.
- **Idempotency**: a booking never consumes from the same vendor's pools twice.
- **Backfill**: when a new pool is created, it retroactively covers eligible past bookings that weren't covered.
- The generated expense per consumption is automatically linked to the correct booking.

### 🔔 Notifications (`/notificaciones`)

- Per-user notification preferences stored in `user_notification_settings`.
- Toggle reminders for: recurring expenses, maintenance schedules, shared bills, damage reports, cleaners.
- Configure lead time (days before due), repeat cadence (`daily`, `every_2_days`, `weekly`), send hour, and timezone.
- **Notifications bell** in nav shows count of pending items.

### 🛠️ Data Issues (`/data-issues`)

- Calls `rpc_data_issues_summary_v2` PostgreSQL function to detect:
  - Expenses paid without a bank account.
  - Cleanings paid without a linked expense or date.
  - Overlapping bookings.
  - Bookings without a payout account.
  - Inconsistent payout amounts.
  - Invalid booking dates or duplicate confirmation codes.
- Allows bulk-fix of orphan expenses (linking them to a property or deleting).
- Conflict resolver and duplicate resolver interactive flows.

### 📄 Financial Report (`/report`)

- Printable, full-page financial report with:
  - KPI summary for the selected period.
  - Monthly P&L table.
  - Booking calendar (colour-coded per property).
  - Detailed booking list with adjustments.
  - Expense breakdown.
  - Credit pool attribution panel.

---

## Financial Model

### Revenue Attribution

Revenue can be attributed in two modes:

- **By days** (`by-days`): a booking's revenue is prorated across the days it falls within the period. Useful for cross-month bookings.
- **By bookings** (`by-bookings`): the full revenue is attributed to the booking's `start_date` month. The default for most reports.

### KPI Calculations

```
Gross Revenue = Booking Revenue + Cancelled Revenue + Net Adjustment Income

Contribution Margin = Gross Revenue − Total Variable Expenses

Net Profit = Contribution Margin − Total Fixed Expenses

Occupancy Rate = Reserved Nights / Available Nights

ADR (Average Daily Rate) = Gross Revenue / Reserved Nights

RevPAR = Gross Revenue / Available Nights

Break-even Nights = Total Fixed Expenses / (ADR − Avg Variable Cost per Night)

Break-even Occupancy % = Break-even Nights / Available Nights × 100
```

Channel fees (Airbnb, Booking.com host fees) are tracked as **informational only** — they are not subtracted from P&L because the `gross_revenue` field already contains the net amount after the platform deducts its fees from the payout.

### Booking Adjustments

`booking_adjustments` rows modify a booking's effective revenue:

| Kind | Effect |
|---|---|
| `extra_income` | +Revenue (damage charge, extra guest fee) |
| `discount` | −Revenue |
| `damage_charge` | +Revenue (explicit damage billing) |
| `platform_refund` | +Revenue (platform-initiated refund to host) |
| `extra_guest_fee` | +Revenue |

### Security Deposit Lifecycle

Security deposits follow a ledger model tracked in `booking_deposit_applications`:

```
booking.security_deposit     ← amount received from guest
      │
      ├── applied_to_damage   ← linked to an expenses.id (damage repair)
      ├── surplus_to_income    ← generates a booking_adjustment extra_income
      └── returned_to_guest   ← money given back to guest

Deposit balance (available) = security_deposit − Σ(applied + surplus + returned)
```

The `deposit_status` column on `bookings` is **auto-computed by a PostgreSQL trigger** (`trg_bda_after_change`) that calls `recompute_booking_deposit_status()` after every insert/update/delete on `booking_deposit_applications`. Possible states: `none | received | applied_to_damage | partial_return | mixed | returned`.

---

## Database & Migrations

The database lives in **Supabase (PostgreSQL)**. All schema changes are versioned as sequential migration files in `supabase/`:

| Range | Content |
|---|---|
| `001–010` | Core schema: properties, listings, bookings, expenses, bank accounts, adjustments, vendors |
| `011–020` | Cleanings, recurring expenses, shared vendors, services, taxonomy, RNT field, expense groups, bank account credit support |
| `021–030` | Vendor business services, cleaner groups, adjustment kinds, inventory, vendor start month, adjustment bank account, credit pools, property groups & tags, credit account type, user timezone |
| `031–040` | Booking payment cash, inventory maintenance, maintenance recurrence, audit remediation, `updated_at` triggers, booking cleanup, composite indexes, RLS hardening, audit log, vendor ID backfill |
| `041–050` | Recurring audit phase A, health check, missing indexes & triggers, `updated_at` for bank accounts, properties & listings, account deposits, inventory end-of-life, missing `updated_at`, booking deposits |
| `051–055` | Paid status invariants, data issues v2 function, credit pool property scope, deposit applications ledger |

### Row Level Security (RLS)

Every table has RLS enabled. All policies follow the pattern:

```sql
CREATE POLICY owner_isolation ON table_name
  FOR ALL USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
```

The `audit_log` table is append-only and written exclusively by a `SECURITY DEFINER` trigger — clients cannot insert or update it directly.

### PostgreSQL Functions

Key database-side functions:

- **`recompute_booking_deposit_status(p_booking_id)`**: recalculates and writes back `deposit_status`, `deposit_returned_amount`, `deposit_return_date` from `booking_deposit_applications` rows.
- **`rpc_data_issues_summary_v2()`**: scans all tables and returns a summary of detected data inconsistencies.
- **`trg_bda_after_change()`**: trigger function that fires after any change to `booking_deposit_applications` to keep `bookings.deposit_status` in sync.
- **Cron jobs** (`cron_auto_checkin.sql`, `cron_auto_checkout.sql`): automatically advance `checkin_done` / `checkout_done` flags based on date.

---

## Service Layer

All data access is centralised in `src/services/`. Services return a consistent `ServiceResult<T>` type:

```typescript
interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}
```

Key services:

| Service | Responsibility |
|---|---|
| `financial.ts` | KPI computation, P&L, revenue charts, payout breakdown, demo mode |
| `bookings.ts` | CRUD, CSV/Excel import, conflict detection, alerts, demo mode |
| `expenses.ts` | CRUD, filters, pagination |
| `deposits.ts` | Security deposit lifecycle (apply, return, surplus conversion, ledger) |
| `transactions.ts` | Financial transaction ledger (income + expenses aggregated for bank reconciliation) |
| `creditPools.ts` | Pool CRUD, FIFO consumption, backfill on pool creation |
| `inventory.ts` | Item catalogue, movements, damage reconciliation, maintenance |
| `recurringPeriods.ts` | Monthly period instances, pending detection |
| `sharedBills.ts` | Shared vendor bill management and auto-split |
| `dataIssues.ts` | Data health check via PostgreSQL RPC |
| `etl.ts` | CSV/Excel parsing and normalisation |
| `export.ts` | CSV/Excel export for bookings, expenses, inventory |

---

## Frontend Architecture

### Astro Pages → React Islands

Each Astro page is a thin wrapper that renders the layout, nav, and one top-level React island (e.g. `<DashboardClient client:idle />`). The island owns all state, data fetching, and sub-component rendering.

### Custom Hooks

Data-fetching hooks in `src/lib/hooks/`:

- **`useDashboardData`**: fetches KPIs, monthly P&L, payout breakdown, and transactions. Cancels in-flight requests when period/filters change (prevents stale setState race conditions).
- **`useReferenceData`**: loads slow-changing reference tables (properties, listings, bank accounts, vendors) once on mount.
- **`useBookingsList`**: paginated, filterable booking list.
- **`useExpensesList`**: paginated, filterable expense list.

### Shared UI Utilities

- **`DataTable.tsx`**: generic TanStack Table wrapper with sorting, pagination, and column visibility.
- **`MoneyInput.tsx`**: currency input with locale-aware parsing.
- **`PropertyMultiSelectFilter.tsx`**: multi-select dropdown for cross-page property filtering.
- **`FilterBar.tsx`**: reusable filter bar component.
- **`PeriodSelector.tsx`**: period picker (preset + custom date range).
- **`ConfirmDeleteChallenge.tsx`**: destructive action confirmation with typed text challenge.

### State Management

No global state library is used. State is:

1. **Local** (`useState`) within feature components.
2. **URL/query-based** for navigation state (currently not implemented; period is passed as prop).
3. **Fetched fresh** on mount and on filter change via service calls.

### Animation

Framer Motion is used throughout for:
- P&L waterfall row entrance animations.
- Modal open/close transitions.
- KPI card loading state transitions.
- Chart entrance animations via `AnimatePresence`.

---

## Authentication & Security

Authentication is handled by **Supabase Auth** (email/password). The auth flow:

1. `/` redirects to `/login`.
2. `LoginForm.tsx` calls `supabase.auth.signInWithPassword()`.
3. `AuthGuard.tsx` wraps protected components, redirecting unauthenticated users.
4. `useAuth.ts` exposes an `AuthStatus`: `'checking' | 'authed' | 'demo'`.
5. All service calls use the singleton `supabase` client, which automatically attaches the session JWT.
6. RLS policies on every table ensure users only ever see their own data.

**Demo mode**: if `authStatus === 'demo'`, the dashboard renders with seeded local data — no Supabase credentials required. Useful for onboarding and public demos.

---

## ETL & CSV Import

`src/services/etl.ts` handles parsing of booking exports from Airbnb (CSV) and Excel:

- **Currency normalisation** (`cleanCurrency`): handles Colombian peso format (`1.520.000`), US format (`1,520,000.50`), and ambiguous single-separator values using digit-count heuristics.
- **Date normalisation** (`parseCSVDate`): supports `d/M/yyyy`, `dd/MM/yyyy`, `M/d/yyyy`, `yyyy-MM-dd`.
- **Column mapping**: maps Airbnb Spanish column names (`'Código de confirmación'`, `'Estado'`, etc.) to the internal schema.
- **Conflict detection** (`datesOverlap`, `ConflictEntry`): compares incoming bookings against existing ones to find overlaps before inserting.
- **Duplicate detection** (`DuplicateEntry`): identifies rows with the same `confirmation_code`.
- **Listing auto-map**: calls `findOrCreateListing` to match the imported `listing_name` to an existing listing (or creates one).
- **Operational flag inference** (`inferOperationalFlags`): for imported bookings, automatically sets `checkin_done` / `checkout_done` based on whether the dates are in the past.

After parsing, `ConflictResolver` and `DuplicateResolver` components offer interactive resolution flows before the final upsert.

---

## Data Integrity & Audit

### Audit Log

An append-only `audit_log` table records all mutations via a PostgreSQL `AFTER` trigger with `SECURITY DEFINER`. Clients cannot bypass it. Each row captures: `table_name`, `operation` (`INSERT | UPDATE | DELETE`), `row_id`, `old_data`, `new_data`, `user_id`, `timestamp`.

### Data Issues Dashboard

The `/data-issues` page provides a self-service data health tool. It runs `rpc_data_issues_summary_v2()` to detect:

- Expenses marked `paid` without a bank account.
- Cleanings paid without a linked expense or a `paid_date`.
- Overlapping booking date ranges for the same listing.
- Bookings with no `payout_bank_account_id` but a non-zero `net_payout`.
- Inconsistent payout amounts (payout > gross revenue).
- Bookings or expenses with invalid/missing dates.
- Duplicate `confirmation_code` values.

Detected issues link to inline fix flows (orphan expense fixer, conflict resolver).

### `updated_at` Triggers

Migrations `035`, `043`, `044`, `045`, `048` progressively added `updated_at` auto-update triggers across all tables, ensuring accurate modification timestamps.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project with the schema applied (see `supabase/setup_completo.sql` or apply migrations sequentially)

### Install

```bash
npm install
```

### Run Dev Server

```bash
npm run dev
```

### Run with Staging Environment

```bash
npm run dev:staging
```

### Build for Production

```bash
npm run build
npm run preview
```

---

## Environment Variables

Create a `.env` file at the project root:

```env
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

For staging, create `.env.staging` with staging project credentials. The `dev:staging` script uses `dotenv-cli` to load it.

> **Note**: Only `PUBLIC_` prefixed variables are exposed to the browser. The anon key is safe to expose — all data isolation is enforced by Supabase RLS, not by keeping the key secret.

---

## Testing

Tests live in `src/__tests__/` and use **Vitest**:

```bash
npm test          # run once
npm run test:watch # watch mode
```

Current test coverage includes:

- **`bookingStatus.test.ts`**: unit tests for the booking state machine (`getBookingStatus`, `isCancelled`, `inferOperationalFlags`, `hasBookingStarted`). These run without any Supabase connection since the logic is pure functions in `src/lib/bookingStatus.ts`.

Pure computation modules (`depositMath.ts`, `creditPoolCalc.ts`, `expenseClassify.ts`) are designed to be easily testable in the same fashion.

---

## Linting & Formatting

```bash
npm run lint          # ESLint (max 25 warnings)
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run typecheck     # tsc --noEmit (strict TypeScript)
```

ESLint config (`eslint.config.mjs`) uses the flat config format and enforces:

- TypeScript strict rules (`@typescript-eslint`)
- React hooks rules (`eslint-plugin-react-hooks`)
- Accessibility (`eslint-plugin-jsx-a11y`)
- Prettier integration (`eslint-config-prettier`)

---

## License

Private — all rights reserved.
