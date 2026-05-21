# Technical Architecture

## 1. System Overview
Built with **Astro (SSR)** for performance and SEO, with **React** for complex interactive modules like data ingestion and dashboard visualization.

## 2. Database Schema (Supabase/PostgreSQL)

### `profiles`
- `id`: UUID (FK to auth.users)
- `full_name`: Text
- `role`: enum ('admin', 'owner')

### `properties`
- `id`: UUID (Primary Key)
- `owner_id`: UUID (FK to profiles)
- `name`: Text
- `address`: Text
- `base_currency`: Text (e.g., 'COP')

### `listings`
- `id`: UUID
- `property_id`: UUID (FK to properties)
- `external_name`: Text (Name as it appears in Airbnb/Other sources)

### `bookings`
- `id`: UUID
- `listing_id`: UUID (FK to listings)
- `confirmation_code`: Text (Unique)
- `guest_name`: Text
- `start_date`: Date
- `end_date`: Date
- `num_nights`: Integer
- `total_revenue`: Numeric(12,2)
- `raw_data`: JSONB

### `expenses`
- `id`: UUID
- `property_id`: UUID (FK to properties)
- `category`: Text (Cleaning, Utilities, etc.)
- `type`: enum ('fixed', 'variable')
- `amount`: Numeric(12,2)
- `date`: Date
- `status`: enum ('pending', 'paid', 'partial')

### `vendors`
- `id`: UUID
- `owner_id`: UUID (FK to profiles)
- `name`: Text
- `kind`: enum ('insurance', 'service', 'supplier', ...)
- Vendors con `kind='insurance'` pueden estar asociados a una bolsa de créditos.

### `vendor_properties`
- `vendor_id`: UUID (FK to vendors)
- `property_id`: UUID (FK to properties)
- Propiedades cubiertas por el vendor. Para bolsas con `vendor_id`, esta tabla define el alcance de consumo.

### `credit_pools` — Bolsas de créditos prepagadas
- `id`: UUID
- `owner_id`: UUID (FK to profiles)
- `vendor_id`: UUID nullable (FK to vendors — null para bolsas manuales sin proveedor)
- `name`: Text (ej. "Colasistencia Q1-2026")
- `credits_total`: Numeric — créditos comprados en esta recarga
- `credits_used`: Numeric — créditos consumidos acumulados
- `total_price`: Numeric — precio pagado por esta tanda
- `consumption_rule`: enum (`per_person_per_night`, `per_person_per_booking`, `per_booking`)
- `credits_per_unit`: Numeric — créditos que consume 1 unidad según la regla
- `child_weight`: Numeric (0–1) — fracción de persona que cuenta un niño
- `activated_at`: Date — desde cuándo aplica la bolsa (≤ booking.start_date para consumir)
- `expires_at`: Date nullable
- `status`: enum (`active`, `archived`)
- `expense_id`: UUID nullable (FK to expenses — liga la bolsa al gasto de compra)

> **Modelo FIFO por recarga**: cada pago al vendor de seguros crea una nueva fila en `credit_pools`. NO se promedia el precio entre recargas. El consumo elige la bolsa más antigua activa primero.

### `credit_pool_properties`
- `pool_id`: UUID (FK to credit_pools)
- `property_id`: UUID (FK to properties)
- Solo se usa cuando la bolsa **no tiene** `vendor_id`. Si tiene vendor, la cobertura se hereda de `vendor_properties`. Una sola fuente por bolsa (dos orígenes según el caso).

### `credit_pool_consumptions`
- `id`: UUID
- `pool_id`: UUID (FK to credit_pools)
- `booking_id`: UUID (FK to bookings)
- `credits_used`: Numeric — créditos descontados de esta bolsa
- `unit_price_snapshot`: Numeric — `total_price / credits_total` al momento del consumo (congela el precio histórico)
- `occurred_at`: Timestamptz
- `notes`: Text nullable (ej. "Split FIFO — excedente de pool anterior")

> **RLS**: todas las tablas de bolsas usan `owner_id = auth.uid()` o un `EXISTS` join hasta llegar al `owner_id`.

## 3. Data Flow (ETL)
1. **Extraction:** Browser-side CSV parsing using `PapaParse`.
2. **Transformation:**
   - Date normalization (ISO-8601).
   - Currency sanitization (Regex to remove symbols/commas).
   - Deduplication based on `confirmation_code`.
3. **Loading:** Bulk upsert to Supabase with RLS validation.

## 4. Security Strategy
- **Auth:** Supabase Auth (JWT).
- **Authorization:** PostgreSQL Row Level Security (RLS) ensures users only access data where `owner_id == auth.uid()`.
