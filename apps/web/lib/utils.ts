import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | string | null | undefined, decimals = 8): string {
  if (n === null || n === undefined) return '-';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '-';
  return num.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

export function formatDate(d: Date | string | null): string {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
