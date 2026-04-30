import { useEffect, useRef, useState } from 'react';
import { formatMoney, maskMoneyInput, parseMoney } from '@/lib/money';

interface MoneyInputProps {
  /** Valor numérico (en unidades de moneda — pesos con hasta 2 decimales). null = vacío. */
  value: number | null;
  /** Se dispara cuando cambia el valor. null si el input quedó vacío. */
  onChange: (value: number | null) => void;
  /** Permite valores negativos (cuentas crédito, descuentos, etc.). */
  allowNegative?: boolean;
  /** Símbolo o prefijo a la izquierda. Por defecto "$". null para ocultar. */
  prefix?: string | null;
  /** Sufijo opcional (ej. "COP"). */
  suffix?: string | null;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  className?: string;
  inputClassName?: string;
  error?: boolean;
  /** Para uso en formularios HTML nativos: nombre del field y valor numérico oculto. */
  hiddenName?: string;
}

/**
 * Input de dinero con máscara es-CO.
 * - Solo permite dígitos y coma para decimales.
 * - Inserta puntos de miles automáticamente mientras se escribe.
 * - Limita a 2 decimales.
 * - El callback `onChange` siempre recibe el número parseado (o null si vacío).
 *
 * Ver `src/lib/money.ts` para la aritmética exacta basada en centavos.
 */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  prefix = '$',
  suffix = null,
  placeholder = '0',
  required,
  disabled,
  autoFocus,
  id,
  name,
  className = '',
  inputClassName = '',
  error,
  hiddenName,
}: MoneyInputProps) {
  // Texto que ve el usuario (con máscara). Se mantiene en estado local
  // para poder mostrar entradas parciales como "1.234," durante el tipeo.
  const [text, setText] = useState<string>(() => (value == null ? '' : formatMoney(value)));
  const lastEmitted = useRef<number | null>(value);

  // Sincronizar cuando `value` cambia externamente (ej. reset del form, prefill).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value == null ? '' : formatMoney(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskMoneyInput(e.target.value, allowNegative);
    setText(masked);
    const parsed = parseMoney(masked);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  const handleBlur = () => {
    if (text === '' || text === '-') return;
    const parsed = parseMoney(text);
    if (parsed != null) setText(formatMoney(parsed));
  };

  const baseInputClasses =
    'w-full text-sm rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50 disabled:text-slate-400';
  const borderClass = error ? 'border-red-400' : 'border-slate-200';
  const paddingClass = `${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-12' : 'pr-3'} py-2 border ${borderClass}`;

  return (
    <div className={`relative ${className}`}>
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error || undefined}
        className={`${baseInputClasses} ${paddingClass} ${inputClassName}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-medium pointer-events-none">
          {suffix}
        </span>
      )}
      {hiddenName && (
        <input type="hidden" name={hiddenName} value={value == null ? '' : String(value)} />
      )}
      {name && !hiddenName && (
        <input type="hidden" name={name} value={value == null ? '' : String(value)} />
      )}
    </div>
  );
}

export default MoneyInput;
