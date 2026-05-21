# Financial Model - STR Management Platform

## 1. Unit Economics & KPI Definitions

### 1.1 Revenue Metrics
- **Gross Revenue (Ingresos Brutos):** Total amount collected from bookings before any deductions. Includes cleaning fees.
- **ADR (Average Daily Rate):** `Total Room Revenue / Number of Booked Nights`.
- **RevPAR (Revenue Per Available Room):** `Total Room Revenue / Total Available Nights in a period`.
- **Net Revenue (Ingreso Neto):** `Gross Revenue - (Platform Commissions + Taxes)`.

### 1.2 Profitability Metrics
- **Contribution Margin:** `Net Revenue - Variable Costs (Cleaning, Laundry, Welcome Kits)`.
- **Net Profit:** `Contribution Margin - Fixed Costs (Internet, Utilities, Administration)`.
- **ROI (Return on Investment):** `(Annual Net Profit / Total Investment) * 100`.

### 1.3 Efficiency Metrics
- **Occupancy Rate:** `(Booked Nights / Available Nights) * 100`.
- **Lead Time:** Days between the booking creation and check-in date.
- **Maintenance-to-Revenue Ratio:** `(Maintenance Costs / Gross Revenue) * 100`.

## 2. Advanced Logic

### 2.1 Pro-rated Revenue (Accrual Method)
Revenue for bookings spanning multiple months is distributed based on the number of nights in each month.
Example: A 10-night stay starting Feb 25 (3 nights in Feb, 7 in March) will have 30% of its revenue allocated to February and 70% to March.

### 2.2 Break-even Point Analysis
The system calculates the number of nights required per month to cover all fixed costs based on the average ADR and variable costs.
`Break-even Nights = Total Fixed Costs / (ADR - Variable Cost per Night)`.

### 2.3 Bolsas de créditos prepagadas (Seguros / Asistencias)

Seguros como Colasistencia se compran por tandas (ej. 1000 créditos = $1.200.000). El sistema distribuye ese costo entre las reservas que realmente los usaron.

#### Ecuación de consumo

```
Unidades = f(regla, personas, noches)
  per_person_per_night    → (adultos + niños × child_weight) × num_nights
  per_person_per_booking  → (adultos + niños × child_weight)
  per_booking             → 1

Créditos usados = Unidades × credits_per_unit

Precio/crédito  = total_price / credits_total         (congelado en unit_price_snapshot)
Costo reserva   = créditos_usados × unit_price_snapshot
```

#### Modelo FIFO por recarga
- Cada pago al vendor de seguros genera una **nueva fila en `credit_pools`** (no se edita ni promedia la bolsa existente).
- Al consumir, el servicio elige la bolsa **más antigua activa con saldo** (`activated_at ASC`).
- Si una bolsa se agota mid-reserva, el excedente se cobra a la siguiente (split → 2 filas en `credit_pool_consumptions`).

#### Scoping por propiedad
- Bolsa con `vendor_id` → cobertura = `vendor_properties` del vendor.
- Bolsa sin vendor → cobertura = `credit_pool_properties` propio.
- Una bolsa sin propiedades configuradas **no consume** (aviso en UI).

#### Atribución informativa (anti-doble-contabilidad)
- El gasto real ya está en el `expense` de compra de la bolsa (ligado al vendor).
- `getCreditPoolCostByProperty` calcula el costo atribuido por propiedad usando `credits_used × unit_price_snapshot`, pero **no inserta en `expenses`**.
- Sirve para unit economics: saber qué propiedad usó qué % del pago. Se muestra en `/expenses`, `PropertyDetailClient` y `PrintReport` como línea virtual informativa.

#### Backfill al crear bolsa
Al nacer una bolsa, `backfillConsumptionsForPool` recorre reservas elegibles (propiedades cubiertas, `start_date ∈ [activated_at, hoy]`) que aún no tengan consumption del mismo vendor, y las consume idempotentemente.
