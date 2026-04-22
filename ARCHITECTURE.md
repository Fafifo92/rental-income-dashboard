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
