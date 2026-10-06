import { prisma } from "../../src/lib/prisma";
import { createProduct, createProductCategory, createCommissionRule } from "../../src/modules/commerce/catalog.service";
import { createDriverSale, getAvailableProductsForDriver } from "../../src/modules/commerce/driver-sale.service";
import { restockDriverInventory, setAvailability } from "../../src/modules/driver-inventory/service";
import {
  createCompletedRide,
  createTestDriver,
  createTestRider,
  disconnectDatabase,
  resetDatabase,
  seedBaseline,
} from "../helpers/db";

async function setupResaleProduct(overrides: Partial<{ ageRestricted: boolean; regulated: boolean; priceCents: number; platformCostCents: number }> = {}) {
  const category = await createProductCategory({
    name: "Beverages",
    slug: "beverages",
    regulatedCategory: overrides.regulated ?? false,
  });
  const product = await createProduct({
    sku: "WATER-500ML",
    name: "Water",
    categoryId: category.id,
    priceCents: overrides.priceCents ?? 200,
    platformCostCents: overrides.platformCostCents ?? 60,
    resaleEligible: !(overrides.ageRestricted || overrides.regulated),
    ageRestricted: overrides.ageRestricted ?? false,
  });
  return { category, product };
}

describe("COMMERCE driver-to-rider resale", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("completes a sale end to end: charges the rider, decrements inventory, splits commission/profit", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const { product } = await setupResaleProduct();
    await restockDriverInventory(driver.id, product.id, 8);

    const sale = await createDriverSale({
      productId: product.id,
      driverId: driver.id,
      riderId: rider.id,
      rideId: ride.id,
      quantity: 2,
    });

    expect(sale.totalSalePriceCents).toBe(400); // 2 * $2.00
    expect(sale.totalPlatformCostCents).toBe(120); // 2 * $0.60
    // Default commission: 20% of gross margin (400 - 120 = 280) = 56
    expect(sale.driverCommissionCents).toBe(56);
    expect(sale.platformProfitCents).toBe(224);

    const inventory = await prisma.driverInventoryItem.findFirstOrThrow({
      where: { driverId: driver.id, productId: product.id },
    });
    expect(inventory.quantityOnHand).toBe(6);

    const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { driverSaleId: sale.id } });
    const byType = Object.fromEntries(ledgerEntries.map((e) => [e.entryType, e.amountCents]));
    expect(byType.DRIVER_SALE_RIDER_CHARGE).toBe(400);
    expect(byType.DRIVER_SALE_DRIVER_COMMISSION).toBe(56);
    expect(byType.DRIVER_SALE_PLATFORM_PROFIT).toBe(224);

    const commissionEarningsLine = await prisma.driverEarningsLine.findFirstOrThrow({
      where: { driverSaleId: sale.id },
    });
    expect(commissionEarningsLine.lineType).toBe("COMMERCE_COMMISSION");
    expect(commissionEarningsLine.amountCents).toBe(56);
  });

  it("respects a product-specific CommissionRule over the platform default", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const { product } = await setupResaleProduct();
    await restockDriverInventory(driver.id, product.id, 8);
    await createCommissionRule({ productId: product.id, type: "PERCENTAGE", value: 0.5 });

    const sale = await createDriverSale({
      productId: product.id,
      driverId: driver.id,
      riderId: rider.id,
      rideId: ride.id,
      quantity: 1,
    });

    // margin = 200 - 60 = 140; 50% of that = 70
    expect(sale.driverCommissionCents).toBe(70);
    expect(sale.platformProfitCents).toBe(70);
  });

  it("posts a platform-loss ledger entry when a commission rule exceeds gross margin instead of dropping it silently", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const { product } = await setupResaleProduct();
    await restockDriverInventory(driver.id, product.id, 8);
    // A FLAT commission of $3.00/unit against a $1.40 margin (200-60) forces
    // a negative platformProfitCents — this must still be ledgered.
    await createCommissionRule({ productId: product.id, type: "FLAT", value: 300 });

    const sale = await createDriverSale({
      productId: product.id,
      driverId: driver.id,
      riderId: rider.id,
      rideId: ride.id,
      quantity: 1,
    });

    expect(sale.driverCommissionCents).toBe(300);
    expect(sale.platformProfitCents).toBe(-160);

    const lossEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { driverSaleId: sale.id, entryType: "DRIVER_SALE_PLATFORM_PROFIT", direction: "DEBIT" },
    });
    expect(lossEntry.amountCents).toBe(160);
  });

  it("rejects a CommissionRule with a PERCENTAGE value outside [0,1]", async () => {
    const category = await createProductCategory({ name: "Snacks", slug: "snacks" });
    const product = await createProduct({
      sku: "CHIPS",
      name: "Chips",
      categoryId: category.id,
      priceCents: 200,
      platformCostCents: 60,
      resaleEligible: true,
    });
    await expect(createCommissionRule({ productId: product.id, type: "PERCENTAGE", value: 1.5 })).rejects.toThrow();
  });

  it.each<[string, { regulated?: boolean; ageRestricted?: boolean }]>([
    ["a regulated category", { regulated: true }],
    ["an age-restricted product", { ageRestricted: true }],
  ])("refuses to sell a product in %s", async (_label, overrides) => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const category = await createProductCategory({
      name: "Restricted",
      slug: "restricted",
      regulatedCategory: overrides.regulated ?? false,
    });
    // Bypass createProduct's own resaleEligible guard (which would already
    // reject this) by writing the row directly, to prove createDriverSale
    // independently refuses it too — defense in depth, not a single gate.
    const product = await prisma.product.create({
      data: {
        sku: "RESTRICTED-ITEM",
        name: "Restricted Item",
        categoryId: category.id,
        priceCents: 500,
        platformCostCents: 100,
        resaleEligible: true,
        ageRestricted: overrides.ageRestricted ?? false,
      },
    });
    await restockDriverInventory(driver.id, product.id, 5);

    await expect(
      createDriverSale({ productId: product.id, driverId: driver.id, riderId: rider.id, rideId: ride.id, quantity: 1 })
    ).rejects.toThrow();
  });

  it("refuses to sell a product not marked resaleEligible", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const category = await createProductCategory({ name: "Internal", slug: "internal" });
    const product = await createProduct({
      sku: "INTERNAL-ONLY",
      name: "Internal supply",
      categoryId: category.id,
      priceCents: 500,
      platformCostCents: 100,
      resaleEligible: false,
    });
    await restockDriverInventory(driver.id, product.id, 5);

    await expect(
      createDriverSale({ productId: product.id, driverId: driver.id, riderId: rider.id, rideId: ride.id, quantity: 1 })
    ).rejects.toThrow();
  });

  it("refuses to sell an expired product", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const category = await createProductCategory({ name: "Snacks", slug: "snacks-2" });
    const product = await createProduct({
      sku: "STALE-CHIPS",
      name: "Chips",
      categoryId: category.id,
      priceCents: 200,
      platformCostCents: 60,
      resaleEligible: true,
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await restockDriverInventory(driver.id, product.id, 5);

    await expect(
      createDriverSale({ productId: product.id, driverId: driver.id, riderId: rider.id, rideId: ride.id, quantity: 1 })
    ).rejects.toThrow();
  });

  it("refuses to sell more than the driver has on hand, and a driver can mark stock unavailable", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const { product } = await setupResaleProduct();
    await restockDriverInventory(driver.id, product.id, 1);

    await expect(
      createDriverSale({ productId: product.id, driverId: driver.id, riderId: rider.id, rideId: ride.id, quantity: 5 })
    ).rejects.toThrow();

    await setAvailability(driver.id, product.id, false);
    const available = await getAvailableProductsForDriver(driver.id);
    expect(available).toHaveLength(0);

    await expect(
      createDriverSale({ productId: product.id, driverId: driver.id, riderId: rider.id, rideId: ride.id, quantity: 1 })
    ).rejects.toThrow();
  });
});
