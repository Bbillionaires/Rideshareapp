import { prisma } from "../../src/lib/prisma";
import { createPayment, issueRefund } from "../../src/modules/payments/service";
import { disconnectDatabase, resetDatabase } from "../helpers/db";

describe("PAYMENTS refunds", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("marks a payment PARTIALLY_REFUNDED then REFUNDED as cumulative refunds reach the original amount", async () => {
    const payment = await prisma.$transaction((tx) =>
      createPayment(tx, { payerType: "RIDER", payerId: "rider-1", amountCents: 1000, method: "CARD_ON_FILE" })
    );

    await prisma.$transaction((tx) => issueRefund(tx, { paymentId: payment.id, amountCents: 400 }));
    let updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.status).toBe("PARTIALLY_REFUNDED");

    await prisma.$transaction((tx) => issueRefund(tx, { paymentId: payment.id, amountCents: 600 }));
    updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.status).toBe("REFUNDED");

    const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(1000);
  });

  it("rejects a refund that would push the cumulative total over the original payment amount", async () => {
    const payment = await prisma.$transaction((tx) =>
      createPayment(tx, { payerType: "RIDER", payerId: "rider-1", amountCents: 1000, method: "CARD_ON_FILE" })
    );

    await prisma.$transaction((tx) => issueRefund(tx, { paymentId: payment.id, amountCents: 700 }));

    await expect(
      prisma.$transaction((tx) => issueRefund(tx, { paymentId: payment.id, amountCents: 700 }))
    ).rejects.toThrow();

    // The rejected attempt must not have been partially applied.
    const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(700);
    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.status).toBe("PARTIALLY_REFUNDED");
  });
});
