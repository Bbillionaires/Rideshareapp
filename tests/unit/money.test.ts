import { applyRate, centsToDollars, dollarsToCents, formatCents, sumCents } from "../../src/lib/money";

describe("money helpers", () => {
  it("converts dollars to cents and back, rounding to the nearest cent", () => {
    expect(dollarsToCents(18.5)).toBe(1850);
    expect(dollarsToCents(2)).toBe(200);
    expect(centsToDollars(1850)).toBe(18.5);
  });

  it("formats cents as currency", () => {
    expect(formatCents(2050)).toBe("$20.50");
  });

  it("applies a decimal rate to a cents amount, rounding to the nearest cent", () => {
    expect(applyRate(980, 0.2)).toBe(196); // 20% of $9.80
    expect(applyRate(1, 0.5)).toBe(1); // rounds 0.5 up
  });

  it("sums a list of cent amounts", () => {
    expect(sumCents(980, 200, 0)).toBe(1180);
    expect(sumCents()).toBe(0);
  });
});
