import { Fragment, useMemo, useState } from 'react';
import type { SharedBillRow, PropertyRow, VendorPropertyRow } from '@/types/database';
import type { Vendor } from '@/services/vendors';
import { formatCurrency } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ymLabel, kindIcon } from './vendorTypes';

interface Props {
  vendors: Vendor[];
  properties: PropertyRow[];
  vendorProperties: VendorPropertyRow[];
  months: string[];
  /** Map "vendorId::ym" → SharedBillRow */
  billByVendorMonth: Map<string, SharedBillRow>;
  /** Map "vendorId::propertyId::ym" → expense amount (paid) */
  expenseByVendorPropMonth: Map<string, number>;
  /** Current YYYY-MM (used to mark future months) */
  currentYm: string;
  onDeleteBill: (bill: SharedBillRow) => void;
  onPay: (vendor: Vendor, ym: string, estimated: number) => void;
}

/**
 * Matriz de pagos a proveedores con desglose por propiedad.
 *
 * Cada fila de proveedor es expandible: al abrirla, aparece una sub-fila por
 * propiedad asignada mostrando cuánto le tocó pagar a cada apartamento en
 * cada mes. Diseñado para servicios públicos + administración, donde un
 * mismo gasto suele dividirse entre varias propiedades.
 */
export default function VendorPaymentsMatrixExpandable({
  vendors, properties, vendorProperties, months,
  billByVendorMonth, expenseByVendorPropMonth, currentYm,
  onDeleteBill, onPay,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const propertyMap = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties]);
  const propsByVendor = useMemo(() => {
    const m = new Map<string, VendorPropertyRow[]>();
    for (const vp of vendorProperties) {
      const arr = m.get(vp.vendor_id) ?? [];
      arr.push(vp);
      m.set(vp.vendor_id, arr);
    }
    return m;
  }, [vendorProperties]);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800">Matriz mensual · servicios y administración</h2>
        <p className="text-[11px] text-slate-500">
          Click en la flecha para ver el desglose por propiedad. Verde = pagado, ámbar = pendiente.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2 sticky left-0 bg-slate-50 min-w-[220px]">Servicio</th>
              {months.map(ym => (
                <th
                  key={ym}
                  className={`text-center px-3 py-2 whitespace-nowrap ${ym > currentYm ? 'text-blue-600' : ''}`}
                >
                  {ymLabel(ym)}
                  {ym > currentYm && <span className="block text-[9px] font-normal normal-case">próximo</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vendors.map(v => {
              const vps = propsByVendor.get(v.id) ?? [];
              const isOpen = expanded.has(v.id);
              return (
                <Fragment key={v.id}>
                  <tr className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggle(v.id)}
                          className="p-0.5 rounded hover:bg-slate-100 text-slate-500 flex-shrink-0"
                          disabled={vps.length === 0}
                          title={vps.length === 0 ? 'Sin propiedades asignadas' : isOpen ? 'Contraer desglose' : 'Ver desglose por propiedad'}
                          aria-label={isOpen ? 'Contraer' : 'Expandir'}
                        >
                          {isOpen
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className={`w-3.5 h-3.5 ${vps.length === 0 ? 'opacity-30' : ''}`} />}
                        </button>
                        <span className="text-base leading-none">{kindIcon(v.kind)}</span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800 text-sm truncate max-w-[180px]" title={v.name}>{v.name}</div>
                          <div className="text-[10px] text-slate-500">
                            {vps.length} prop · {v.default_amount != null ? formatCurrency(Number(v.default_amount)) : '—'}
                          </div>
                        </div>
                      </div>
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
                      if (vps.length === 0) {
                        return <td key={ym} className="px-2 py-1.5 text-center text-slate-300">—</td>;
                      }
                      const estimated = Number(v.default_amount ?? 0);
                      const isFuture = ym > currentYm;
                      return (
                        <td key={ym} className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => onPay(v, ym, estimated)}
                            title={isFuture ? `Pagar por adelantado · estimado ${formatCurrency(estimated)}` : `Pendiente · estimado ${formatCurrency(estimated)}`}
                            className={`w-full px-2 py-1 rounded border text-[11px] font-semibold ${
                              isFuture
                                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            }`}
                          >
                            {isFuture ? '➕ Pagar' : '⏳ Pagar'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && vps.map(vp => {
                    const prop = propertyMap.get(vp.property_id);
                    const propName = prop?.name ?? vp.property_id.slice(0, 8);
                    return (
                      <tr key={`${v.id}::${vp.property_id}`} className="bg-slate-50/40">
                        <td className="px-4 py-1.5 sticky left-0 bg-slate-50/40 pl-12">
                          <span className="text-[10px] text-slate-400 mr-1">└</span>
                          <span className="text-[11px] text-slate-700">{propName}</span>
                          {vp.share_percent != null && (
                            <span className="ml-2 text-[10px] text-slate-400">{vp.share_percent}%</span>
                          )}
                          {vp.fixed_amount != null && (
                            <span className="ml-2 text-[10px] text-slate-400">{formatCurrency(Number(vp.fixed_amount))} fijo</span>
                          )}
                        </td>
                        {months.map(ym => {
                          const amount = expenseByVendorPropMonth.get(`${v.id}::${vp.property_id}::${ym}`);
                          if (amount != null) {
                            return (
                              <td key={ym} className="px-2 py-1 text-center text-[11px] text-emerald-700 font-mono">
                                {formatCurrency(amount)}
                              </td>
                            );
                          }
                          if (v.start_year_month && ym < v.start_year_month) {
                            return <td key={ym} className="px-2 py-1 text-center text-slate-300 text-[10px]">·</td>;
                          }
                          return <td key={ym} className="px-2 py-1 text-center text-slate-300 text-[10px]">—</td>;
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
