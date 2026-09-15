import { DiscountType, FulfillmentMethod, FulfillmentStatus, Order, OrderStatus } from "@prisma/client";
import type { PrismaTx } from "../../lib/prisma";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { applyRate, sumCents } from "../../lib/money";
import { postLedgerEntry } from "../../lib/ledger";
import { createPayment, issueRefund as issuePaymentRefund } from "../payments/service";

/**
 * COMMERCE module — driver store orders: a driver buying supplies from the
 * platform for personal use and/or to restock DriverInventory. Distinct from
 * driver-sale.service.ts, which is the driver-to-rider resale transaction.
 */

async function resolveInventoryLocation(tx: PrismaTx, locationId?: string) {
  if (locationId) {
    const location = await tx.inventoryLocation.findUnique({ where: { id: locationId } });
    if (!location) notFound(`InventoryLocation ${locationId} not found`);
    return location!;
  }
  const location = await tx.inventoryLocation.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!location) badRequest("No active InventoryLocation is configured");
  return location!;
}

/**
 * Applies any active AUTOMATIC discount (code: null, within its date window,
 * under its usage limit) that scopes to this product or its category.
 * Explicit discount codes are stored/managed via catalog.service.ts but
 * redemption-by-code at checkout is out of scope for this MVP — only
 * automatic discounts are applied here. When more than one automatic
 * discount matches, the one yielding the larger savings wins.
 */
async function computeAutomaticDiscountCents(
  tx: PrismaTx,
  product: { id: string; categoryId: string },
  lineTotalCents: number,
  now: Date
): Promise<{ discountCents: number; appliedDiscountId: string | null }> {
  const candidates = await tx.discount.findMany({
    where: {
      AND: [
        { code: null },
        { active: true },
        { startsAt: { lte: now } },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        { OR: [{ productId: product.id }, { categoryId: product.categoryId }] },
      ],
    },
  });

  const usable = candidates.filter((d) => d.usageLimit == null || d.usageCount < d.usageLimit);

  let bestDiscountCents = 0;
  let bestDiscountId: string | null = null;
  for (const d of usable) {
    const rate = d.value.toNumber();
    const amount =
      d.type === DiscountType.PERCENTAGE
        ? applyRate(lineTotalCents, rate)
        : Math.min(lineTotalCents, Math.round(rate));
    if (amount > bestDiscountCents) {
      bestDiscountCents = amount;
      bestDiscountId = d.id;
    }
  }

  return { discountCents: bestDiscountCents, appliedDiscountId: bestDiscountId };
}

export interface PlaceOrderItemInput {
  productId?: string;
  bundleId?: string;
  quantity: number;
}

export interface PlaceOrderInput {
  buyerDriverId: string;
  items: PlaceOrderItemInput[];
  locationId?: string; // optional explicit InventoryLocation; defaults to first active location
}

export async function placeOrder(input: PlaceOrderInput): Promise<Order> {
  if (!input.items || input.items.length === 0) {
    badRequest("Order must include at least one item");
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const location = await resolveInventoryLocation(tx, input.locationId);

    let subtotalCents = 0;
    let discountCents = 0;
    let platformCostTotalCents = 0;
    const appliedDiscountIds: string[] = [];
    const stockDecrements = new Map<string, number>();

    const orderItemsData: Array<{
      productId: string | null;
      bundleId: string | null;
      skuSnapshot: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
    }> = [];

    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        badRequest("Each order item needs a positive integer quantity");
      }
      if (!item.productId && !item.bundleId) {
        badRequest("Each order item needs either a productId or a bundleId");
      }

      if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) notFound(`Product ${item.productId} not found`);
        if (product!.status !== "ACTIVE") {
          badRequest(`Product ${product!.id} is not ACTIVE (status=${product!.status})`);
        }

        const lineTotalCents = product!.priceCents * item.quantity;
        const { discountCents: lineDiscountCents, appliedDiscountId } =
          await computeAutomaticDiscountCents(
            tx,
            { id: product!.id, categoryId: product!.categoryId },
            lineTotalCents,
            now
          );
        if (appliedDiscountId) appliedDiscountIds.push(appliedDiscountId);

        subtotalCents += lineTotalCents;
        discountCents += lineDiscountCents;
        platformCostTotalCents += product!.platformCostCents * item.quantity;

        orderItemsData.push({
          productId: product!.id,
          bundleId: null,
          skuSnapshot: product!.sku,
          quantity: item.quantity,
          unitPriceCents: product!.priceCents,
          lineTotalCents,
        });

        stockDecrements.set(product!.id, (stockDecrements.get(product!.id) ?? 0) + item.quantity);
      } else {
        const bundle = await tx.bundle.findUnique({
          where: { id: item.bundleId! },
          include: { items: { include: { product: true } } },
        });
        if (!bundle) notFound(`Bundle ${item.bundleId} not found`);
        if (!bundle!.active) badRequest(`Bundle ${bundle!.id} is not active`);

        for (const bundleItem of bundle!.items) {
          if (bundleItem.product.status !== "ACTIVE") {
            badRequest(
              `Bundle ${bundle!.id} contains inactive product ${bundleItem.productId} (status=${bundleItem.product.status})`
            );
          }
        }

        // Bundles are priced as a single unit (Bundle.priceCents); no
        // per-product automatic discount is applied to bundle contents in
        // this MVP (Discount scopes to a Product/ProductCategory, not a
        // Bundle) — a bundle's discount, if any, would be its own priceCents.
        const lineTotalCents = bundle!.priceCents * item.quantity;
        const bundlePlatformCostCents = sumCents(
          ...bundle!.items.map((bundleItem) => bundleItem.product.platformCostCents * bundleItem.quantity)
        );

        subtotalCents += lineTotalCents;
        platformCostTotalCents += bundlePlatformCostCents * item.quantity;

        orderItemsData.push({
          productId: null,
          bundleId: bundle!.id,
          skuSnapshot: `BUNDLE-${bundle!.id}`,
          quantity: item.quantity,
          unitPriceCents: bundle!.priceCents,
          lineTotalCents,
        });

        for (const bundleItem of bundle!.items) {
          stockDecrements.set(
            bundleItem.productId,
            (stockDecrements.get(bundleItem.productId) ?? 0) + bundleItem.quantity * item.quantity
          );
        }
      }
    }

    // No tax-rate configuration model exists in the schema yet — tax is 0
    // until one is introduced (documented gap, not invented here).
    const taxCents = 0;
    const totalCents = subtotalCents - discountCents + taxCents;

    const order = await tx.order.create({
      data: {
        buyerDriverId: input.buyerDriverId,
        status: "PENDING",
        subtotalCents,
        discountCents,
        taxCents,
        totalCents,
        items: { create: orderItemsData },
      },
    });

    // The driver pays via the platform (card on file) — never handled as a
    // peer-to-peer transaction.
    const payment = await createPayment(tx, {
      payerType: "DRIVER",
      payerId: input.buyerDriverId,
      orderId: order.id,
      amountCents: totalCents,
      method: "CARD_ON_FILE",
      status: "CAPTURED",
    });

    for (const [productId, quantity] of stockDecrements) {
      const stock = await tx.inventoryStock.findUnique({
        where: { productId_locationId: { productId, locationId: location.id } },
      });
      if (!stock || stock.quantityOnHand < quantity) {
        badRequest(
          `Insufficient inventory for product ${productId} at location ${location.name} (have ${
            stock?.quantityOnHand ?? 0
          }, need ${quantity})`
        );
      }
      await tx.inventoryStock.update({
        where: { productId_locationId: { productId, locationId: location.id } },
        data: { quantityOnHand: { decrement: quantity } },
      });
    }

    for (const discountId of appliedDiscountIds) {
      await tx.discount.update({
        where: { id: discountId },
        data: { usageCount: { increment: 1 } },
      });
    }

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID" },
      include: { items: true, payments: true },
    });

    // Platform-vs-platform bookkeeping: the driver already paid via the
    // Payment leg above, so no DRIVER-party ledger row is needed for the
    // purchase itself.
    if (totalCents > 0) {
      await postLedgerEntry(tx, {
        entryType: "DRIVER_STORE_PURCHASE_REVENUE",
        sourceModule: "COMMERCE",
        direction: "CREDIT",
        partyType: "PLATFORM",
        orderId: order.id,
        paymentId: payment.id,
        amountCents: totalCents,
        description: `Driver store purchase revenue for order ${order.id}`,
      });
    }
    if (platformCostTotalCents > 0) {
      await postLedgerEntry(tx, {
        entryType: "DRIVER_STORE_PURCHASE_COGS",
        sourceModule: "COMMERCE",
        direction: "DEBIT",
        partyType: "PLATFORM",
        orderId: order.id,
        amountCents: platformCostTotalCents,
        description: `Driver store COGS for order ${order.id}`,
      });
    }

    return updatedOrder;
  });
}

export async function issueRefund(
  orderId: string,
  amountCents: number,
  reason?: string,
  issuedBy?: string
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order) notFound(`Order ${orderId} not found`);

    const payment = order!.payments[0];
    if (!payment) badRequest(`Order ${orderId} has no payment to refund`);

    const refund = await issuePaymentRefund(tx, {
      paymentId: payment!.id,
      amountCents,
      reason,
      issuedBy,
    });

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        status: amountCents >= order!.totalCents ? OrderStatus.REFUNDED : order!.status,
      },
    });

    return { refund, order: updatedOrder };
  });
}

export interface ViewOrdersFilters {
  buyerDriverId?: string;
  status?: OrderStatus;
  startDate?: Date;
  endDate?: Date;
}

export async function viewOrders(filters: ViewOrdersFilters = {}) {
  return prisma.order.findMany({
    where: {
      buyerDriverId: filters.buyerDriverId,
      status: filters.status,
      placedAt: { gte: filters.startDate, lte: filters.endDate },
    },
    include: { items: true, payments: true, fulfillments: true },
    orderBy: { placedAt: "desc" },
  });
}

export interface SalesAnalyticsDateRange {
  startDate?: Date;
  endDate?: Date;
}

/**
 * revenueCents/cogsCents/marginCents are read directly off the ledger (the
 * single source of truth for money movement) rather than recomputed from
 * Order/OrderItem, so they always agree with DriverEarningsLine/other
 * ledger-derived views. topProducts/byCategory are informational and are
 * computed from OrderItem line totals (gross, pre-discount, PAID/FULFILLED
 * orders only) since the ledger only records order-level totals, not
 * per-line detail.
 */
export async function viewSalesAnalytics(dateRange: SalesAnalyticsDateRange = {}) {
  const occurredAt = { gte: dateRange.startDate, lte: dateRange.endDate };

  const [revenueEntries, cogsEntries] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { entryType: "DRIVER_STORE_PURCHASE_REVENUE", sourceModule: "COMMERCE", occurredAt },
      select: { amountCents: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { entryType: "DRIVER_STORE_PURCHASE_COGS", sourceModule: "COMMERCE", occurredAt },
      select: { amountCents: true },
    }),
  ]);

  const revenueCents = sumCents(...revenueEntries.map((e) => e.amountCents));
  const cogsCents = sumCents(...cogsEntries.map((e) => e.amountCents));

  const items = await prisma.orderItem.findMany({
    where: {
      productId: { not: null },
      order: {
        status: { in: [OrderStatus.PAID, OrderStatus.FULFILLED] },
        placedAt: { gte: dateRange.startDate, lte: dateRange.endDate },
      },
    },
    include: { product: { include: { category: true } } },
  });

  const byProduct = new Map<
    string,
    { name: string; sku: string; revenueCents: number; quantity: number }
  >();
  const byCategory = new Map<string, { name: string; revenueCents: number }>();

  for (const item of items) {
    if (!item.product) continue;
    const existing = byProduct.get(item.product.id) ?? {
      name: item.product.name,
      sku: item.product.sku,
      revenueCents: 0,
      quantity: 0,
    };
    existing.revenueCents += item.lineTotalCents;
    existing.quantity += item.quantity;
    byProduct.set(item.product.id, existing);

    const catExisting = byCategory.get(item.product.categoryId) ?? {
      name: item.product.category.name,
      revenueCents: 0,
    };
    catExisting.revenueCents += item.lineTotalCents;
    byCategory.set(item.product.categoryId, catExisting);
  }

  const topProducts = [...byProduct.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 20);

  const categoryBreakdown = [...byCategory.entries()].map(([categoryId, v]) => ({
    categoryId,
    ...v,
  }));

  return {
    revenueCents,
    cogsCents,
    marginCents: revenueCents - cogsCents,
    topProducts,
    byCategory: categoryBreakdown,
  };
}

export interface CreateFulfillmentInput {
  method: FulfillmentMethod;
  carrier?: string;
  trackingNumber?: string;
}

export async function createFulfillment(orderId: string, input: CreateFulfillmentInput) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) notFound(`Order ${orderId} not found`);

  return prisma.fulfillment.create({
    data: {
      orderId,
      method: input.method,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      status: "PENDING",
    },
  });
}

export async function updateFulfillmentStatus(
  fulfillmentId: string,
  status: FulfillmentStatus,
  extra: { carrier?: string; trackingNumber?: string } = {}
) {
  return prisma.$transaction(async (tx) => {
    const fulfillment = await tx.fulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!fulfillment) notFound(`Fulfillment ${fulfillmentId} not found`);

    const updated = await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        status,
        carrier: extra.carrier ?? fulfillment!.carrier,
        trackingNumber: extra.trackingNumber ?? fulfillment!.trackingNumber,
        shippedAt: status === "SHIPPED" ? new Date() : fulfillment!.shippedAt,
        deliveredAt: status === "DELIVERED" ? new Date() : fulfillment!.deliveredAt,
      },
    });

    if (status === "DELIVERED") {
      await tx.order.update({
        where: { id: fulfillment!.orderId },
        data: { status: "FULFILLED", fulfilledAt: new Date() },
      });
    }

    return updated;
  });
}
