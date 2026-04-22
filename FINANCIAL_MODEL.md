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
