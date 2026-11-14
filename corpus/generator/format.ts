// How each GP prints numbers. The pipeline's normalization step (5) has to undo exactly these variations.
export type NumberStyle = {
  divisor: number; // 1_000_000 for "EUR m", 1_000 for "EUR k", 1 for exact amounts
  decimals: number;
  thousands: string;
  decimal: string;
  negative: "minus" | "parentheses";
  unitLabel: string; // printed in table headers, e.g. "EUR m"
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatAmount(value: number, style: NumberStyle): string {
  const [whole = "0", fraction] = (Math.abs(value) / style.divisor).toFixed(style.decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, style.thousands);
  const body = fraction ? `${grouped}${style.decimal}${fraction}` : grouped;
  if (value >= 0) return body;
  return style.negative === "parentheses" ? `(${body})` : `-${body}`;
}

export const formatRatio = (value: number, decimal = ".") => `${value.toFixed(2).replace(".", decimal)}x`;

export const formatPercent = (value: number, decimals = 1, decimal = ".") =>
  `${(value * 100).toFixed(decimals).replace(".", decimal)}%`;

export function formatPeriodLabel(periodEnd: string): string {
  const [year, month] = periodEnd.split("-").map(Number);
  return `Q${Math.ceil((month ?? 1) / 3)} ${year}`;
}

export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}
