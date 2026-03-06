export function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const ms  = parseInt(match[1]) * map[match[2].toLowerCase()];
  if (ms > 28 * 86400000) return null;
  return { ms, label: str.toLowerCase() };
}
export function formatMs(ms) {
  const s = Math.floor(ms/1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h/24)}d`;
}
