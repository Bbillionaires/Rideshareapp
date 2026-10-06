import type { PrismaTx } from "../../lib/prisma";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";

/**
 * DRIVER_INVENTORY module: per-driver on-hand stock of platform-approved
 * products, available for driver-to-rider resale (COMMERCE module). Kept
 * separate from InventoryStock (COMMERCE's warehouse/location stock) — a
 * driver's on-hand quantity is populated by restocking (typically after the
 * driver's own Order is fulfilled) and drawn down by DriverSale.
 */

export async function restockDriverInventory(
  driverId: string,
  productId: string,
  quantity: number
) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    badRequest("quantity must be a positive integer");
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound(`Product ${productId} not found`);

  return prisma.driverInventoryItem.upsert({
    where: { driverId_productId: { driverId, productId } },
    create: {
      driverId,
      productId,
      quantityOnHand: quantity,
      lastRestockedAt: new Date(),
    },
    update: {
      quantityOnHand: { increment: quantity },
      lastRestockedAt: new Date(),
    },
  });
}

export async function setAvailability(
  driverId: string,
  productId: string,
  isAvailableForSale: boolean
) {
  const item = await prisma.driverInventoryItem.findUnique({
    where: { driverId_productId: { driverId, productId } },
  });
  if (!item) {
    notFound(`Driver ${driverId} has no inventory item for product ${productId}`);
  }

  return prisma.driverInventoryItem.update({
    where: { driverId_productId: { driverId, productId } },
    data: { isAvailableForSale },
  });
}

/** Powers the driver-facing "MY INVENTORY: Water x8, Chips x5..." view. */
export async function getMyInventory(driverId: string) {
  return prisma.driverInventoryItem.findMany({
    where: { driverId },
    include: {
      product: {
        select: { id: true, name: true, sku: true, priceCents: true, status: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Called from within the DriverSale transaction (COMMERCE module owns the
 * resale flow; DRIVER_INVENTORY only owns the stock decrement itself).
 * Throws badRequest if there isn't enough available stock, matching the
 * "prevent sale of ... unavailable products" requirement at the inventory
 * layer (product-level eligibility — expired/recalled/disabled/regulated —
 * is validated by the COMMERCE caller before this is invoked).
 */
export async function decrementForSale(
  tx: PrismaTx,
  driverId: string,
  productId: string,
  quantity: number
) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    badRequest("quantity must be a positive integer");
  }

  const item = await tx.driverInventoryItem.findUnique({
    where: { driverId_productId: { driverId, productId } },
  });
  if (!item) {
    badRequest(`Driver ${driverId} has no inventory for product ${productId}`);
  }
  if (!item!.isAvailableForSale) {
    badRequest(`Driver ${driverId} has marked product ${productId} unavailable for sale`);
  }
  if (item!.quantityOnHand < quantity) {
    badRequest(
      `Driver ${driverId} has insufficient stock for product ${productId} (has ${item!.quantityOnHand}, needs ${quantity})`
    );
  }

  return tx.driverInventoryItem.update({
    where: { driverId_productId: { driverId, productId } },
    data: { quantityOnHand: { decrement: quantity } },
  });
}
