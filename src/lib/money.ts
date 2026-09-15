/**
 * All money in this codebase is represented as integer cents. Never use
 * floating point for currency math — round at each computation boundary.
 */

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    centsToDollars(cents)
  );
}

/** Applies a decimal rate (e.g. 0.08 for 8%) to a cents amount, rounding to the nearest cent. */
export function applyRate(baseCents: number, rate: number): number {
  return Math.round(baseCents * rate);
}

export function sumCents(...amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
