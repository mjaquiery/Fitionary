const LABELS: Record<string, string> = { 'e-z curl bar': 'EZ curl bar' };

/** Display form of a data value: "middle back" → "Middle back" */
export function capitalize(text: string): string {
  const label = LABELS[text] ?? text;
  return label ? label[0].toUpperCase() + label.slice(1) : label;
}

/** 0 → "0:00", 65 → "1:05", 3725 → "1:02:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Human duration: 45 → "45 s", 90 → "2 min", 3900 → "1 h 5 min" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function listToText(items: readonly string[]): string {
  return items.map(capitalize).join(', ');
}
