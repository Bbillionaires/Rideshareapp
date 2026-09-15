import { PayerType, Payment, PaymentStatus, Refund } from "@prisma/client";
import type { PrismaTx } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { postLedgerEntry } from "../../lib/ledger";

/**
 * PAYMENTS module: generic payment/refund processing shared by COMMERCE
 * (driver store orders, driver-to-rider resale) and any future caller.
 * Every write here takes a transaction client so callers can include it in
 * their own atomic transaction alongside the domain row(s) it belongs to.
 */

export interface CreatePaymentInput {
  payerType: PayerType;
  payerId: string;
  orderId?: string | null;
  amountCents: number;
  method: string;
  status?: PaymentStatus;
  processorRef?: string | null;
  currency?: string;
}

export async function createPayment(tx: PrismaTx, input: CreatePaymentInput): Promise<Payment> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    badRequest("Payment amountCents must be a non-negative integer");
  }

  const status = input.status ?? PaymentStatus.CAPTURED;
  return tx.payment.create({
    data: {
      payerType: input.payerType,
      payerId: input.payerId,
      orderId: input.orderId ?? null,
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      method: input.method,
      processorRef: input.processorRef ?? null,
      status,
      capturedAt: status === PaymentStatus.CAPTURED ? new Date() : null,
    },
  });
}

export interface IssueRefundInput {
  paymentId: string;
  amountCents: number;
  reason?: string | null;
  issuedBy?: string | null;
}

/**
 * Refund direction convention: the original payment took money FROM the
 * payer (rider or driver) and gave it TO the platform — modeled elsewhere as
 * a DEBIT against that payer's party and a CREDIT to PLATFORM (see e.g.
 * DRIVER_SALE_RIDER_CHARGE / DRIVER_STORE_PURCHASE_REVENUE). A refund is the
 * mirror image: money flows back FROM the platform TO the payer. We record
 * that as a single CREDIT entry against the payer's own party type — the
 * same convention used for DRIVER_SALE_DRIVER_COMMISSION (a CREDIT means
 * "this party receives money"). We don't need a second, explicit PLATFORM
 * DEBIT row: the REFUND entry type combined with partyType already tells a
 * reader which party gave the money back, and every original charge already
 * has its own CREDIT/PLATFORM entry on record for the forward flow.
 */
export async function issueRefund(tx: PrismaTx, input: IssueRefundInput): Promise<Refund> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    badRequest("Refund amountCents must be a positive integer");
  }

  const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) notFound(`Payment ${input.paymentId} not found`);

  const refund = await tx.refund.create({
    data: {
      paymentId: payment!.id,
      amountCents: input.amountCents,
      reason: input.reason ?? null,
      issuedBy: input.issuedBy ?? null,
      status: "ISSUED",
    },
  });

  const newStatus =
    input.amountCents >= payment!.amountCents
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;

  await tx.payment.update({
    where: { id: payment!.id },
    data: { status: newStatus },
  });

  const partyType =
    payment!.payerType === PayerType.DRIVER
      ? "DRIVER"
      : payment!.payerType === PayerType.RIDER
      ? "RIDER"
      : "ADVERTISER";

  await postLedgerEntry(tx, {
    entryType: "REFUND",
    sourceModule: "PAYMENTS",
    direction: "CREDIT",
    partyType,
    partyId: payment!.payerId,
    driverId: payment!.payerType === PayerType.DRIVER ? payment!.payerId : null,
    orderId: payment!.orderId ?? null,
    paymentId: payment!.id,
    refundId: refund.id,
    amountCents: input.amountCents,
    description: input.reason ?? `Refund for payment ${payment!.id}`,
  });

  return refund;
}
