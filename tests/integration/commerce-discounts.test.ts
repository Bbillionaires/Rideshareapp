import { prisma } from "../../src/lib/prisma";
import { createDiscount, createProduct, createProductCategory } from "../../src/modules/commerce/catalog.service";
import { placeOrder } from "../../src/modules/commerce/orders.service";
import { createTestDriver, disconnectDatabase, resetDatabase, seedBaseline } from "../helpers/db";

describe("COMMERCE discounts", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("rejects a PERCENTAGE discount value outside [0,1] at creation", async () => {
    const category = await createProductCategory({ name: "Snacks", slug: "snacks" });
    await expect(
      createDiscount({
        name: "Mistyped 150% off",
        type: "PERCENTAGE",
        value: 1.5,
        categoryId: category.id,
        startsAt: new Date(Date.now() - 86_400_000),
      })
    ).rejects.toThrow();
  });

  it("rejects a negative FIXED_AMOUNT discount value", async () => {
    const category = await createProductCategory({ name: "Snacks", slug: "snacks" });
    await expect(
      createDiscount({
        name: "Negative discount",
        type: "FIXED_AMOUNT",
        value: -50,
        categoryId: category.id,
        startsAt: new Date(Date.now() - 86_400_000),
      })
    ).rejects.toThrow();
  });

  it("never lets an automatic discount reduce an order line below zero", async () => {
    const { location } = await seedBaseline();
    const driver = await createTestDriver();
    const category = await createProductCategory({ name: "Snacks", slug: "snacks" });
    const product = await createProduct({
      sku: "CHIPS",
      name: "Chips",
      categoryId: category.id,
      priceCents: 200,
      platformCostCents: 60,
    });
    await prisma.inventoryStock.create({
      data: { productId: product.id, locationId: location.id, quantityOnHand: 100 },
    });
    // A valid 100% storewide automatic discount is the boundary case: it
    // should zero the line out, never go negative.
    await createDiscount({
      name: "Storewide 100% off",
      type: "PERCENTAGE",
      value: 1,
      startsAt: new Date(Date.now() - 86_400_000),
    });

    const order = await placeOrder({ buyerDriverId: driver.id, items: [{ productId: product.id, quantity: 3 }] });
    expect(order.totalCents).toBeGreaterThanOrEqual(0);
    expect(order.totalCents).toBe(0);
    expect(order.discountCents).toBe(600);
  });
});
