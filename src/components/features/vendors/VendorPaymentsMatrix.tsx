import type { SharedBillRow } from '@/types/database';
import type { Vendor } from '@/services/vendors';
import { formatCurrency } from '@/lib/utils';
import { ymLabel } from './vendorTypes';

interface Props {
  vendors: Vendor[];
  months: string[];
  propsCountByVendor: Map<string, number>;
  billByVendorMonth: Map<string, SharedBillRow>;
  onDeleteBill: (bill: SharedBillRow) => void;
  onPay: (vendor: Vendor, ym: string, estimated: number) => void;
}

export default function VendorPaymentsMatrix({
  vendors, months, propsCountByVendor, billByVendorMonth, onDeleteBill, onPay,
}: Props) {
  return (
    <section className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Matriz de pagos mensuales</h2>
          <p className="text-[11px] text-slate-500">Click en una celda para registrar o ver el pago. Verde = pagado, ámbar = pendiente.</p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2 sticky left-0 bg-slate-50">Servicio</th>
              {months.map(ym => (
                <th key={ym} className="text-center px-3 py-2 whitespace-nowrap">{ymLabel(ym)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vendors.map(v => {
              const props = propsCountByVendor.get(v.id) ?? 0;
              return (
                <tr key={v.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 sticky left-0 bg-white">
                    <div className="font-medium text-slate-800 text-sm truncate max-w-[200px]" title={v.name}>{v.name}</div>
                    <div className="text-[10px] text-slate-500">{props} prop · {v.default_amount != null ? formatCurrency(Number(v.default_amount)) : '—'}</div>
                  </td>
                  {months.map(ym => {
                    const bill = billByVendorMonth.get(`${v.id}::${ym}`);
                    if (bill) {
                      return (
                        <td key={ym} className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => onDeleteBill(bill)}
                            title={`Pagado el ${bill.paid_date} · ${formatCurrency(Number(bill.total_amount))}\nClick para anular`}
                            className="w-full px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-[11px] font-semibold"
                          >
                            ✓ {formatCurrency(Number(bill.total_amount))}
                          </button>
                        </td>
                      );
                    }
                    if (v.start_year_month && ym < v.start_year_month) {
                      return <td key={ym} className="px-2 py-1.5 text-center text-slate-300" title="Anterior a la fecha de inicio del proveedor">·</td>;
                    }
                    if (props === 0) {
                      return <td key={ym} className="px-2 py-1.5 text-center text-slate-300">—</td>;
                    }
                    const estimated = Number(v.default_amount ?? 0);
                    return (
                      <td key={ym} className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => onPay(v, ym, estimated)}
                          title={`Pendiente · estimado ${formatCurrency(estimated)}`}
                          className="w-full px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-semibold"
                        >
                          ⏳ Pagar
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
