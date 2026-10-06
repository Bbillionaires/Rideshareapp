import * as RidesService from "../../src/modules/rides/service";
import {
  createGasVehicle,
  createTestDriver,
  createTestRider,
  disconnectDatabase,
  resetDatabase,
  seedBaseline,
} from "../helpers/db";

describe("RIDES listing", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("filters by riderId (ride history) and by status+marketId (available rides for drivers)", async () => {
    const { market, standard } = await seedBaseline();
    const riderA = await createTestRider();
    const riderB = await createTestRider();
    const driver = await createTestDriver();
    const vehicle = await createGasVehicle(driver.id, market.id);

    const rideA1 = await RidesService.requestRide({
      riderId: riderA.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await RidesService.requestRide({
      riderId: riderB.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await RidesService.acceptRide(rideA1.id, driver.id, vehicle.id);

    const riderAHistory = await RidesService.listRides({ riderId: riderA.id });
    expect(riderAHistory).toHaveLength(1);
    expect(riderAHistory[0].id).toBe(rideA1.id);

    const requestedInMarket = await RidesService.listRides({
      status: "REQUESTED",
      marketId: market.id,
    });
    // rideA1 is now ACCEPTED, so only riderB's ride should show as REQUESTED.
    expect(requestedInMarket).toHaveLength(1);
    expect(requestedInMarket[0].riderId).toBe(riderB.id);

    const driverRides = await RidesService.listRides({ driverId: driver.id });
    expect(driverRides).toHaveLength(1);
    expect(driverRides[0].id).toBe(rideA1.id);
  });

  it("includes fare and payments on each listed ride", async () => {
    const { market, standard } = await seedBaseline();
    const rider = await createTestRider();
    const driver = await createTestDriver();
    const vehicle = await createGasVehicle(driver.id, market.id);
    const ride = await RidesService.requestRide({
      riderId: rider.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await RidesService.acceptRide(ride.id, driver.id, vehicle.id);
    await RidesService.startRide(ride.id);
    await RidesService.completeRide(ride.id, { distanceMiles: 5, durationMinutes: 15 });

    const rides = await RidesService.listRides({ riderId: rider.id });
    expect(rides).toHaveLength(1);
    expect(rides[0].fare).not.toBeNull();
    expect(rides[0].fare!.riderTotalChargeCents).toBeGreaterThan(0);
    // No STRIPE_SECRET_KEY in the test env (see tests/env.ts) — payments is
    // expected to be empty, proving ride completion never throws without it.
    expect(rides[0].payments).toEqual([]);
  });
});
