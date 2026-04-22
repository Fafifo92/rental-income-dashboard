import { parse } from 'date-fns';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';

export interface RawAirbnbRow {
  'Código de confirmación': string;
  'Estado': string;
  'Nombre del huésped': string;
  'Fecha de inicio': string;
  'Hasta': string;
  'Número de noches': string;
  'Anuncio': string;
  'Ingresos': string;
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

export const cleanCurrency = (val: string): number => {
  return parseFloat(val.replace(/[$,\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
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
  start_date: parseCSVDate(row['Fecha de inicio'] ?? ''),
  end_date: parseCSVDate(row['Hasta'] ?? ''),
  num_nights: parseInt(row['Número de noches'] ?? '0') || 0,
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
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== null && row[i] !== undefined ? String(row[i]) : '';
    });
    return transformRow(obj as RawAirbnbRow);
  });
};

export const parseAirbnbFile = (file: File): Promise<ParsedBooking[]> => {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') return parseXLSXFile(file);
  return parseCSVFile(file);
};
