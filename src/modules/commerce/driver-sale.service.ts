import { CommissionType, DriverSale, DriverSaleStatus, ProductStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { applyRate } from "../../lib/money";
import { postDriverEarningsLine, postLedgerEntry, postRiderReceiptLine } from "../../lib/ledger";
import { createPayment, issueRefund as issuePaymentRefund } from "../payments/service";
import { decrementForSale } from "../driver-inventory/service";

/**
 * COMMERCE module — the driver-to-rider resale transaction ("AVAILABLE FROM
 * YOUR DRIVER"). Every sellable item is a platform Product/SKU; drivers can
 * never upload arbitrary products. COMMERCE depends on DRIVER_INVENTORY for
 * stock decrement (imported directly, per the module dependency direction
 * given in the task).
 */

// Platform default driver commission when no CommissionRule matches the
// product or its category: 20% of gross margin (sale price minus platform
// cost) — never a flat share of revenue, so the default commission is
// always proportional to the profit the sale actually generated and can
// never (by construction) exceed the margin itself.
const DEFAULT_COMMISSION_RATE = 0.2;

/**
 * Powers the rider-facing "AVAILABLE FROM YOUR DRIVER" screen: only stock
 * the driver has on hand, has not marked unavailable, whose product is
 * ACTIVE, resaleEligible, and not expired.
 */
export async function getAvailableProductsForDriver(driverId: string) {
  const now = new Date();
  return prisma.driverInventoryItem.findMany({
    where: {
      driverId,
      isAvailableForSale: true,
      quantityOnHand: { gt: 0 },
      product: {
        status: ProductStatus.ACTIVE,
        resaleEligible: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    include: { product: true },
    orderBy: { updatedAt: "desc" },
  });
}

export interface CreateDriverSaleInput {
  productId: string;
  driverId: string;
  riderId: string;
  rideId: string;
  quantity: number;
}

export async function createDriverSale(input: CreateDriverSaleInput): Promise<DriverSale> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    badRequest("quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    const product = await tx.product.findUnique({
      where: { id: input.productId },
      include: { category: true },
    });
    if (!product) notFound(`Product ${input.productId} not found`);

    // Prevent sale of expired, recalled, disabled, or unavailable products.
    // RECALLED/DISABLED/DISCONTINUED are all covered by the status check.
    if (product!.status !== ProductStatus.ACTIVE) {
      badRequest(`Product ${product!.id} is not ACTIVE (status=${product!.status})`);
    }
    if (!product!.resaleEligible) {
      badRequest(`Product ${product!.id} is not designated resaleEligible`);
    }
    // Unconditional MVP restriction — regulated/age-restricted merchandise
    // (alcohol, tobacco/nicotine, cannabis, prescription drugs, weapons,
    // other age-restricted/regulated goods) can never be resold, regardless
    // of any other flag on the product.
    if (product!.category.regulatedCategory) {
      badRequest(`Product ${product!.id} belongs to a regulated category and cannot be resold`);
    }
    if (product!.ageRestricted) {
      badRequest(`Product ${product!.id} is age-restricted and cannot be resold`);
    }
    if (product!.expiresAt && product!.expiresAt < now) {
      badRequest(`Product ${product!.id} is expired`);
    }

    // Enforces the driver has enough available (not-marked-unavailable)
    // on-hand stock, and decrements it.
    await decrementForSale(tx, input.driverId, input.productId, input.quantity);

    const unitSalePriceCents = product!.priceCents;
    const totalSalePriceCents = unitSalePriceCents * input.quantity;
    const unitPlatformCostCents = product!.platformCostCents;
    const totalPlatformCostCents = unitPlatformCostCents * input.quantity;
    const grossMarginCents = totalSalePriceCents - totalPlatformCostCents;

    const rule =
      (await tx.commissionRule.findFirst({
        where: {
          productId: product!.id,
          active: true,
          effectiveStart: { lte: now },
          OR: [{ effectiveEnd: null }, { effectiveEnd: { gte: now } }],
        },
      })) ??
      (await tx.commissionRule.findFirst({
        where: {
          categoryId: product!.categoryId,
          active: true,
          effectiveStart: { lte: now },
          OR: [{ effectiveEnd: null }, { effectiveEnd: { gte: now } }],
        },
      }));

    let driverCommissionCents: number;
    if (rule) {
      const value = rule.value.toNumber();
      driverCommissionCents =
        rule.type === CommissionType.PERCENTAGE
          ? applyRate(grossMarginCents, value)
          : Math.round(value) * input.quantity;
    } else {
      driverCommissionCents = applyRate(grossMarginCents, DEFAULT_COMMISSION_RATE);
    }

    const platformProfitCents = totalSalePriceCents - totalPlatformCostCents - driverCommissionCents;

    // The driver never touches the rider's card payment — the charge is
    // created directly against the rider through PAYMENTS.
    const payment = await createPayment(tx, {
      payerType: "RIDER",
      payerId: input.riderId,
      amountCents: totalSalePriceCents,
      method: "CARD_ON_FILE",
      status: "CAPTURED",
    });

    const sale = await tx.driverSale.create({
      data: {
        productId: product!.id,
        skuSnapshot: product!.sku,
        driverId: input.driverId,
        riderId: input.riderId,
        rideId: input.rideId,
        quantity: input.quantity,
        unitSalePriceCents,
        totalSalePriceCents,
        unitPlatformCostCents,
        totalPlatformCostCents,
        driverCommissionCents,
        platformProfitCents,
        paymentId: payment.id,
        status: DriverSaleStatus.COMPLETED,
      },
    });

    const riderChargeEntry = await postLedgerEntry(tx, {
      entryType: "DRIVER_SALE_RIDER_CHARGE",
      sourceModule: "COMMERCE",
      direction: "DEBIT",
      partyType: "RIDER",
      partyId: input.riderId,
      rideId: input.rideId,
      driverSaleId: sale.id,
      paymentId: payment.id,
      amountCents: totalSalePriceCents,
      description: `Driver sale of ${input.quantity}x ${product!.sku}`,
    });

    await postRiderReceiptLine(tx, {
      rideId: input.rideId,
      lineType: "PRODUCT_PURCHASE",
      amountCents: totalSalePriceCents,
      ledgerEntryId: riderChargeEntry.id,
      driverSaleId: sale.id,
      description: `${input.quantity}x ${product!.name}`,
    });

    // Only post an entry if its amount is > 0 — postLedgerEntry rejects
    // non-positive amounts, and a zero/negative commission or profit simply
    // has nothing to record.
    if (driverCommissionCents > 0) {
      const commissionEntry = await postLedgerEntry(tx, {
        entryType: "DRIVER_SALE_DRIVER_COMMISSION",
        sourceModule: "COMMERCE",
        direction: "CREDIT",
        partyType: "DRIVER",
        partyId: input.driverId,
        driverId: input.driverId,
        rideId: input.rideId,
        driverSaleId: sale.id,
        amountCents: driverCommissionCents,
        description: `Driver commission on sale ${sale.id}`,
      });

      // Kept as its own ledger entry / earnings line (COMMERCE_COMMISSION),
      // never commingled with ride earnings (RIDE_BASE/EV_SUPPLEMENT/etc).
      await postDriverEarningsLine(tx, {
        driverId: input.driverId,
        rideId: input.rideId,
        lineType: "COMMERCE_COMMISSION",
        amountCents: driverCommissionCents,
        ledgerEntryId: commissionEntry.id,
        driverSaleId: sale.id,
      });
    }

    if (platformProfitCents > 0) {
      await postLedgerEntry(tx, {
        entryType: "DRIVER_SALE_PLATFORM_PROFIT",
        sourceModule: "COMMERCE",
        direction: "CREDIT",
        partyType: "PLATFORM",
        rideId: input.rideId,
        driverSaleId: sale.id,
        amountCents: platformProfitCents,
        description: `Platform profit on sale ${sale.id}`,
      });
    } else if (platformProfitCents < 0) {
      // A misconfigured (or since-changed) CommissionRule can pay the driver
      // more than the sale's gross margin. That should be prevented at the
      // source (see catalog.service.ts's validateCommissionRuleInput, which
      // bounds PERCENTAGE to [0,1] of margin), but if it ever happens anyway
      // the loss must still be traceable in the ledger rather than silently
      // dropped — post it as a PLATFORM debit under the same entry type.
      await postLedgerEntry(tx, {
        entryType: "DRIVER_SALE_PLATFORM_PROFIT",
        sourceModule: "COMMERCE",
        direction: "DEBIT",
        partyType: "PLATFORM",
        rideId: input.rideId,
        driverSaleId: sale.id,
        amountCents: Math.abs(platformProfitCents),
        description: `Platform loss on sale ${sale.id} (driver commission exceeded gross margin)`,
      });
    }

    return sale;
  });
}

export async function refundDriverSale(driverSaleId: string, reason?: string, issuedBy?: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.driverSale.findUnique({ where: { id: driverSaleId } });
    if (!sale) notFound(`DriverSale ${driverSaleId} not found`);
    if (sale!.status === DriverSaleStatus.REFUNDED) {
      badRequest(`DriverSale ${driverSaleId} is already refunded`);
    }
    if (!sale!.paymentId) {
      badRequest(`DriverSale ${driverSaleId} has no associated payment`);
    }

    await issuePaymentRefund(tx, {
      paymentId: sale!.paymentId!,
      amountCents: sale!.totalSalePriceCents,
      reason,
      issuedBy,
    });

    return tx.driverSale.update({
      where: { id: driverSaleId },
      data: { status: DriverSaleStatus.REFUNDED },
    });
  });
}
