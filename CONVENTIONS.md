# Development Conventions

## 1. Naming Standards
- **Files:** kebab-case (e.g., `revenue-chart.tsx`).
- **Components:** PascalCase (e.g., `RevenueChart`).
- **Functions:** camelCase.
- **DB Tables:** snake_case (plural).

## 2. Directory Structure
- `/src/components/ui`: Shadcn/ui (Radix + Tailwind).
- `/src/components/features`: Domain-specific React components.
- `/src/services`: Business logic (ETL, Calculations).
- `/src/types`: Centralized TypeScript interfaces.

## 3. Strict Typing Rules
- **No `any` allowed.** All data must be typed.
- Financial values must be handled as `number` with explicit rounding logic in services.
- Database results must be typed using generated Supabase types or manual interfaces.

## 4. UI/UX Rules
- **Modern Look:** Use a clean, SaaS-grade palette.
- **Responsiveness:** All dashboards must be fully usable on mobile.
- **Animations:** Use `Framer Motion` for transitions and state changes.

## 5. Booking adjustments vs Expenses (Bloque 3)
- `booking_adjustments` representa **ÚNICAMENTE flujos de dinero ligados a una reserva específica** (huésped, plataforma).
  - Kinds: `extra_income`, `extra_guest_fee`, `discount`, `damage_charge`, `platform_refund`.
  - Todos suman al neto excepto `discount` que resta.
- **NO** son ajustes y **NO** deben modelarse aquí:
  - Servicios públicos (luz, agua, gas, internet) → `expenses` con `expense_group_id` y prorrateo multi-propiedad (Bloque 6).
  - Pagos al personal de aseo → `booking_cleanings` + `expenses` consolidado al liquidar (Bloque 9).
  - Suscripciones SaaS, Cámara de Comercio, marketing → `expenses` con vendor `kind = business_service` (Bloque 12).

