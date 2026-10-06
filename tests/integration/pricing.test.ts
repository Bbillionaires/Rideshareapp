import { prisma } from "../../src/lib/prisma";
import { computeAndPostRideFare } from "../../src/modules/pricing/service";
import { createCompletedRide, createTestDriver, createTestRider, disconnectDatabase, resetDatabase, seedBaseline } from "../helpers/db";

describe("PRICING", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("reconciles the rider charge exactly against driver earnings + platform fee", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      distanceMiles: 5,
      durationMinutes: 15,
    });

    const fresh = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    const fare = await computeAndPostRideFare(fresh);

    expect(fare.riderTotalChargeCents).toBe(fare.driverBaseEarningsCents + fare.platformServiceFeeCents);

    const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { rideId: ride.id } });
    const byType = Object.fromEntries(ledgerEntries.map((e) => [e.entryType, e.amountCents]));
    expect(byType.RIDE_FARE_RIDER_CHARGE).toBe(fare.riderTotalChargeCents);
    expect(byType.RIDE_BASE_DRIVER_EARNINGS).toBe(fare.driverBaseEarningsCents);
    expect(byType.PLATFORM_SERVICE_FEE).toBe(fare.platformServiceFeeCents);
  });

  it("is idempotent: computing the fare twice for the same ride returns the existing fare without duplicating ledger entries", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const fresh = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });

    const first = await computeAndPostRideFare(fresh);
    const second = await computeAndPostRideFare(fresh);
    expect(second.id).toBe(first.id);

    const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { rideId: ride.id } });
    expect(ledgerEntries).toHaveLength(3); // rider charge + driver earnings + platform fee, exactly once
  });
});
