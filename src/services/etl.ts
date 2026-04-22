import { parse } from 'date-fns';

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

export const cleanCurrency = (val: string): number => {
  return parseFloat(val.replace(/[$,]/g, '')) || 0;
};

export const parseCSVDate = (dateStr: string): string => {
  try {
    // Expected format: dd/MM/yyyy
    const parsed = parse(dateStr, 'd/M/yyyy', new Date());
    return parsed.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
};

export const transformRow = (row: RawAirbnbRow) => {
  return {
    confirmation_code: row['Código de confirmación'],
    status: row['Estado'],
    guest_name: row['Nombre del huésped'],
    start_date: parseCSVDate(row['Fecha de inicio']),
    end_date: parseCSVDate(row['Hasta']),
    num_nights: parseInt(row['Número de noches']) || 0,
    listing_name: row['Anuncio'],
    revenue: cleanCurrency(row['Ingresos'])
  };
};
