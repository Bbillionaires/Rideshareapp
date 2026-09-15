import { prisma } from "../../src/lib/prisma";

/**
 * Every table in the schema, truncated together (CASCADE handles FK order
 * regardless of listing order) to give each test a clean slate. Keep this in
 * sync with prisma/schema.prisma's @@map names — a table added there and
 * forgotten here just means leftover rows leak between tests, so if a new
 * test starts seeing unexplained cross-test state, check this list first.
 */
const ALL_TABLES = [
  "markets",
  "zones",
  "zip_zone_mappings",
  "service_types",
  "drivers",
  "vehicles",
  "riders",
  "rides",
  "ride_offers",
  "driver_online_sessions",
  "charging_sessions",
  "ride_fares",
  "ev_compensation_rules",
  "ev_bonus_line_items",
  "sponsors",
  "sponsorship_programs",
  "sponsorship_contributions",
  "product_categories",
  "products",
  "product_images",
  "discounts",
  "bundles",
  "bundle_items",
  "inventory_locations",
  "inventory_stock",
  "orders",
  "order_items",
  "fulfillments",
  "commission_rules",
  "driver_sales",
  "driver_inventory_items",
  "payments",
  "refunds",
  "advertisers",
  "ad_campaigns",
  "ad_creatives",
  "ad_campaign_placements",
  "ad_target_rules",
  "ad_impressions",
  "ad_clicks",
  "ad_conversions",
  "promo_code_redemptions",
  "ad_consent_records",
  "tos_acceptances",
  "ledger_entries",
  "driver_earnings_lines",
  "rider_receipt_lines",
];

export async function resetDatabase(): Promise<void> {
  const quoted = ALL_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/** Baseline reference data most tests need: one market, its service types. */
export async function seedBaseline() {
  const market = await prisma.market.create({
    data: { name: "Jacksonville", code: "JAX", timezone: "America/New_York" },
  });
  const standard = await prisma.serviceType.create({ data: { code: "STANDARD", name: "Standard" } });
  const xl = await prisma.serviceType.create({ data: { code: "XL", name: "XL" } });
  const location = await prisma.inventoryLocation.create({ data: { name: "Central Warehouse" } });
  return { market, standard, xl, location };
}

let driverCounter = 0;
let riderCounter = 0;

export async function createTestDriver(overrides: Partial<{ name: string; email: string }> = {}) {
  driverCounter += 1;
  return prisma.driver.create({
    data: {
      name: overrides.name ?? `Test Driver ${driverCounter}`,
      email: overrides.email ?? `driver${driverCounter}@test.example`,
    },
  });
}

export async function createTestRider(overrides: Partial<{ name: string; email: string }> = {}) {
  riderCounter += 1;
  return prisma.rider.create({
    data: {
      name: overrides.name ?? `Test Rider ${riderCounter}`,
      email: overrides.email ?? `rider${riderCounter}@test.example`,
    },
  });
}

export async function createEvVehicle(driverId: string, marketId: string) {
  return prisma.vehicle.create({
    data: {
      driverId,
      marketId,
      make: "Tesla",
      model: "Model 3",
      year: 2023,
      plate: `EV-${Math.random().toString(36).slice(2, 8)}`,
      fuelType: "EV",
      approvalStatus: "APPROVED",
      verifiedAt: new Date(),
      active: true,
    },
  });
}

export async function createGasVehicle(driverId: string, marketId: string) {
  return prisma.vehicle.create({
    data: {
      driverId,
      marketId,
      make: "Toyota",
      model: "Camry",
      year: 2020,
      plate: `GAS-${Math.random().toString(36).slice(2, 8)}`,
      fuelType: "GAS",
      approvalStatus: "APPROVED",
      verifiedAt: new Date(),
      active: true,
    },
  });
}

/** Creates and completes a ride in one step (request → accept → start → complete). */
export async function createCompletedRide(input: {
  riderId: string;
  driverId: string;
  vehicleId?: string | null;
  marketId: string;
  serviceTypeId: string;
  distanceMiles?: number;
  durationMinutes?: number;
}) {
  const ride = await prisma.ride.create({
    data: {
      riderId: input.riderId,
      driverId: input.driverId,
      vehicleId: input.vehicleId ?? null,
      marketId: input.marketId,
      serviceTypeId: input.serviceTypeId,
      status: "ACCEPTED",
      acceptedAt: new Date(),
      startedAt: new Date(),
    },
  });
  return prisma.ride.update({
    where: { id: ride.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      distanceMiles: input.distanceMiles ?? 5,
      durationMinutes: input.durationMinutes ?? 15,
    },
  });
}
