const MINUTE = 60_000;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

/** Compact relative time, matching the feed convention: 3m, 2h, 5d, 3w. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const delta = Math.max(0, now - then);

  if (delta < MINUTE) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < DAY * 7) return `${Math.floor(delta / DAY)}d`;
  if (delta < DAY * 365) return `${Math.floor(delta / (DAY * 7))}w`;
  return `${Math.floor(delta / (DAY * 365))}y`;
}

/** Full timestamp for accessibility labels and tooltips. */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function formatCount(n: number | undefined): string {
  if (!n || n < 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}
