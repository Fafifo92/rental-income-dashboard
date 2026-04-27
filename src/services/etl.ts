import { parse } from 'date-fns';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';

export interface RawAirbnbRow {
  'Código de confirmación': string;
  'Estado': string;
  'Nombre del huésped': string;
  'Fecha de inicio': string;
  'Hasta': string;
  'Número de noches': string | number;
  'Anuncio': string;
  'Ingresos': string | number;
}

export interface ParsedBooking {
  confirmation_code: string;
  status: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  listing_name: string;
  revenue: number;
}

export const cleanCurrency = (val: string | number): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  // Strip currency symbols and whitespace
  const s = String(val).replace(/[$\s]/g, '').trim();
  if (!s || !/\d/.test(s)) return 0;

  const dotCount   = (s.match(/\./g) ?? []).length;
  const commaCount = (s.match(/,/g) ?? []).length;

  // Multiple dots → Colombian/EU: "1.520.000" or "1.520.000,50"
  if (dotCount > 1) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }

  // Multiple commas → US with cents: "1,520,000.50"
  if (commaCount > 1) {
    return parseFloat(s.replace(/,/g, '')) || 0;
  }

  // Single separator — use digit-count heuristic to decide if it's thousands or decimal
  const lastDot   = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const lastSep   = Math.max(lastDot, lastComma);
  const afterSep  = s.substring(lastSep + 1);

  if (afterSep.length === 3) {
    // Exactly 3 digits after separator → thousands ("380,000" or "380.000")
    return parseFloat(s.replace(/[.,]/g, '')) || 0;
  }

  // 0, 1, 2, or other digit count → treat last separator as decimal
  const isCommaDec = lastComma > lastDot;
  if (isCommaDec) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(s.replace(/,/g, '')) || 0;
};

export const parseCSVDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const formats = ['d/M/yyyy', 'dd/MM/yyyy', 'M/d/yyyy', 'yyyy-MM-dd'];
  for (const fmt of formats) {
    try {
      const parsed = parse(dateStr.trim(), fmt, new Date());
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    } catch {
      // try next format
    }
  }
  return dateStr;
};

export const transformRow = (row: RawAirbnbRow): ParsedBooking => ({
  confirmation_code: row['Código de confirmación'] ?? '',
  status: row['Estado'] ?? '',
  guest_name: row['Nombre del huésped'] ?? '',
  start_date: parseCSVDate(String(row['Fecha de inicio'] ?? '')),
  end_date: parseCSVDate(String(row['Hasta'] ?? '')),
  num_nights: typeof row['Número de noches'] === 'number'
    ? row['Número de noches']
    : parseInt(String(row['Número de noches'] ?? '0')) || 0,
  listing_name: row['Anuncio'] ?? '',
  revenue: cleanCurrency(row['Ingresos'] ?? '0'),
});

export const parseCSVFile = (file: File): Promise<ParsedBooking[]> =>
  new Promise((resolve, reject) => {
    Papa.parse<RawAirbnbRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data.map(transformRow)),
      error: reject,
    });
  });

export const parseXLSXFile = async (file: File): Promise<ParsedBooking[]> => {
  const rows = await readXlsxFile(file);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h ?? ''));
  return rows.slice(1).map(row => {
    // Keep numbers as numbers so cleanCurrency can handle them correctly.
    // String-convert only for fields that are always text (codes, names, dates, listing).
    const obj: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = v !== null && v !== undefined ? (typeof v === 'number' ? v : String(v)) : '';
    });
    return transformRow(obj as unknown as RawAirbnbRow);
  });
};

export const parseAirbnbFile = (file: File): Promise<ParsedBooking[]> => {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') return parseXLSXFile(file);
  return parseCSVFile(file);
};
