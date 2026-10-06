import * as AccountsService from "../../src/modules/accounts/service";
import { disconnectDatabase, resetDatabase, seedBaseline } from "../helpers/db";

describe("ACCOUNTS", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("creates and fetches a driver and a rider", async () => {
    const driver = await AccountsService.createDriver({ name: "Dana Driver", email: "dana@test.example" });
    const fetchedDriver = await AccountsService.getDriver(driver.id);
    expect(fetchedDriver.name).toBe("Dana Driver");

    const rider = await AccountsService.createRider({ name: "Rhea Rider", email: "rhea@test.example" });
    const fetchedRider = await AccountsService.getRider(rider.id);
    expect(fetchedRider.name).toBe("Rhea Rider");
  });

  it("rejects a driver/rider created without a name or email", async () => {
    await expect(AccountsService.createDriver({ name: "", email: "x@test.example" })).rejects.toThrow();
    await expect(AccountsService.createDriver({ name: "X", email: "" })).rejects.toThrow();
    await expect(AccountsService.createRider({ name: "", email: "x@test.example" })).rejects.toThrow();
  });

  it("creates a pre-approved vehicle for a driver and lists it", async () => {
    const { market } = await seedBaseline();
    const driver = await AccountsService.createDriver({ name: "Dana Driver", email: "dana@test.example" });

    const vehicle = await AccountsService.createVehicle({
      driverId: driver.id,
      marketId: market.id,
      make: "Tesla",
      model: "Model 3",
      year: 2023,
      plate: "EV-1234",
      fuelType: "EV",
    });
    expect(vehicle.approvalStatus).toBe("APPROVED");

    const vehicles = await AccountsService.listVehiclesForDriver(driver.id);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe(vehicle.id);
  });

  it("404s creating a vehicle for a market that doesn't exist", async () => {
    const driver = await AccountsService.createDriver({ name: "Dana Driver", email: "dana@test.example" });
    await expect(
      AccountsService.createVehicle({
        driverId: driver.id,
        marketId: "does-not-exist",
        make: "Tesla",
        model: "Model 3",
        year: 2023,
        plate: "EV-1234",
        fuelType: "EV",
      })
    ).rejects.toThrow();
  });

  it("takes a driver online then offline, tracking duration, and rejects double-online", async () => {
    const { market } = await seedBaseline();
    const driver = await AccountsService.createDriver({ name: "Dana Driver", email: "dana@test.example" });

    let status = await AccountsService.getDriverStatus(driver.id);
    expect(status.online).toBe(false);

    await AccountsService.goOnline(driver.id, { marketId: market.id });
    status = await AccountsService.getDriverStatus(driver.id);
    expect(status.online).toBe(true);

    await expect(AccountsService.goOnline(driver.id, { marketId: market.id })).rejects.toThrow();

    const ended = await AccountsService.goOffline(driver.id);
    expect(ended.endedAt).not.toBeNull();
    expect(ended.durationMinutes).toBeGreaterThanOrEqual(0);

    status = await AccountsService.getDriverStatus(driver.id);
    expect(status.online).toBe(false);

    await expect(AccountsService.goOffline(driver.id)).rejects.toThrow();
  });

  it("lists active markets and service types seeded by the baseline fixture", async () => {
    await seedBaseline();
    const markets = await AccountsService.listMarkets();
    const serviceTypes = await AccountsService.listServiceTypes();
    expect(markets.map((m) => m.code)).toContain("JAX");
    expect(serviceTypes.map((s) => s.code).sort()).toEqual(["STANDARD", "XL"]);
  });
});
