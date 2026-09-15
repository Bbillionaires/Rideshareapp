import {
  BoundedModule,
  DriverEarningsLineType,
  LedgerDirection,
  LedgerEntryType,
  LedgerPartyType,
  RiderReceiptLineType,
} from "@prisma/client";
import type { PrismaTx } from "./prisma";

/**
 * This module is the ONLY place that should write to LedgerEntry,
 * DriverEarningsLine, and RiderReceiptLine. Every other module posts money
 * by calling postLedgerEntry (directly or through a helper below) — never
 * by writing a bespoke "amount" field on a module-specific table.
 *
 * Rules enforced here:
 *   - amountCents must be a positive integer (direction + partyType convey
 *     the sign/flow; a signed amount would let callers silently net two
 *     flows into one row, defeating traceability).
 *   - Ledger rows are never updated or deleted by application code. A
 *     correction is always a new, offsetting entry (see postRefund).
 */

export interface LedgerEntryInput {
  entryType: LedgerEntryType;
  sourceModule: BoundedModule;
  direction: LedgerDirection;
  partyType: LedgerPartyType;
  partyId?: string | null;
  driverId?: string | null;
  amountCents: number;
  currency?: string;
  rideId?: string | null;
  orderId?: string | null;
  driverSaleId?: string | null;
  evBonusLineItemId?: string | null;
  sponsorshipContributionId?: string | null;
  adCampaignId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  description?: string | null;
  occurredAt?: Date;
}

function assertPositiveCents(amountCents: number, context: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(
      `${context}: amountCents must be a positive integer, got ${amountCents}`
    );
  }
}

export async function postLedgerEntry(tx: PrismaTx, input: LedgerEntryInput) {
  assertPositiveCents(input.amountCents, `postLedgerEntry(${input.entryType})`);
  return tx.ledgerEntry.create({
    data: {
      entryType: input.entryType,
      sourceModule: input.sourceModule,
      direction: input.direction,
      partyType: input.partyType,
      partyId: input.partyId ?? null,
      driverId: input.driverId ?? null,
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      rideId: input.rideId ?? null,
      orderId: input.orderId ?? null,
      driverSaleId: input.driverSaleId ?? null,
      evBonusLineItemId: input.evBonusLineItemId ?? null,
      sponsorshipContributionId: input.sponsorshipContributionId ?? null,
      adCampaignId: input.adCampaignId ?? null,
      paymentId: input.paymentId ?? null,
      refundId: input.refundId ?? null,
      description: input.description ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

export async function postLedgerEntries(tx: PrismaTx, inputs: LedgerEntryInput[]) {
  const results = [];
  for (const input of inputs) {
    results.push(await postLedgerEntry(tx, input));
  }
  return results;
}

export interface DriverEarningsLineInput {
  driverId: string;
  rideId?: string | null;
  lineType: DriverEarningsLineType;
  amountCents: number;
  description?: string | null;
  ledgerEntryId: string;
  evBonusLineItemId?: string | null;
  driverSaleId?: string | null;
}

/** Records a driver-facing earnings breakdown line alongside its ledger entry. */
export async function postDriverEarningsLine(
  tx: PrismaTx,
  input: DriverEarningsLineInput
) {
  assertPositiveCents(input.amountCents, `postDriverEarningsLine(${input.lineType})`);
  return tx.driverEarningsLine.create({
    data: {
      driverId: input.driverId,
      rideId: input.rideId ?? null,
      lineType: input.lineType,
      amountCents: input.amountCents,
      description: input.description ?? null,
      ledgerEntryId: input.ledgerEntryId,
      evBonusLineItemId: input.evBonusLineItemId ?? null,
      driverSaleId: input.driverSaleId ?? null,
    },
  });
}

export interface RiderReceiptLineInput {
  rideId: string;
  lineType: RiderReceiptLineType;
  amountCents: number;
  description?: string | null;
  ledgerEntryId: string;
  evBonusLineItemId?: string | null;
  driverSaleId?: string | null;
}

/** Records a rider-facing receipt line alongside its ledger entry. */
export async function postRiderReceiptLine(tx: PrismaTx, input: RiderReceiptLineInput) {
  assertPositiveCents(input.amountCents, `postRiderReceiptLine(${input.lineType})`);
  return tx.riderReceiptLine.create({
    data: {
      rideId: input.rideId,
      lineType: input.lineType,
      amountCents: input.amountCents,
      description: input.description ?? null,
      ledgerEntryId: input.ledgerEntryId,
      evBonusLineItemId: input.evBonusLineItemId ?? null,
      driverSaleId: input.driverSaleId ?? null,
    },
  });
}
