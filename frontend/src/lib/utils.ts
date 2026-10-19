export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDeviation(dev: number | null): string {
  if (dev === null || isNaN(dev)) return "-";
  if (dev > 0) return `+${dev.toFixed(3)}`;
  return dev.toFixed(3);
}
