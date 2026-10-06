/**
 * Full end-to-end verification of the "Done when" criterion: a test rider
 * and a test driver complete a paid ride, in test mode, driven entirely
 * through the real HTTP API (supertest against the actual Express app —
 * not direct service-function calls like most other integration tests use).
 *
 * The Stripe SDK is mocked (see tests/integration/stripe-payments.test.ts for
 * why — no real Stripe test key is available in CI/sandbox environments) to
 * simulate a successful test-mode charge; everything else — accounts, ride
 * lifecycle, fare computation, ledger, payment persistence — is the real
 * backend, hitting a real local Postgres.
 */
const mockCreate = jest.fn();
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockCreate },
  }));
});

import request from "supertest";
import { createApp } from "../../src/index";
import { disconnectDatabase, resetDatabase, seedBaseline } from "../helpers/db";

describe("End-to-end: rider requests a ride, driver completes it, Stripe charges the fare", () => {
  const app = createApp();
  const ORIGINAL_ENV = process.env.STRIPE_SECRET_KEY;

  afterAll(async () => {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_ENV;
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (params: { amount: number }) => ({
      id: `pi_test_${Math.random().toString(36).slice(2, 10)}`,
      status: "succeeded",
      amount: params.amount,
    }));
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_e2e_test";
  });

  it("runs the full rider + driver + payment lifecycle", async () => {
    const { market, standard } = await seedBaseline();

    // --- Rider creates an account ---
    const riderRes = await request(app)
      .post("/accounts/riders")
      .send({ name: "E2E Rider", email: "e2e-rider@test.example" })
      .expect(201);
    const riderId = riderRes.body.id;

    // --- Driver creates an account + a vehicle, then goes online ---
    const driverRes = await request(app)
      .post("/accounts/drivers")
      .send({ name: "E2E Driver", email: "e2e-driver@test.example" })
      .expect(201);
    const driverId = driverRes.body.id;

    const vehicleRes = await request(app)
      .post("/accounts/vehicles")
      .send({
        driverId,
        marketId: market.id,
        make: "Toyota",
        model: "Camry",
        year: 2021,
        plate: "E2E-001",
        fuelType: "GAS",
      })
      .expect(201);
    const vehicleId = vehicleRes.body.id;

    await request(app)
      .post(`/accounts/drivers/${driverId}/online`)
      .send({ marketId: market.id, vehicleId })
      .expect(201);

    const statusRes = await request(app).get(`/accounts/drivers/${driverId}/status`).expect(200);
    expect(statusRes.body.online).toBe(true);

    // --- Rider requests a ride ---
    const rideRes = await request(app)
      .post("/rides")
      .send({ riderId, marketId: market.id, serviceTypeId: standard.id })
      .expect(201);
    const rideId = rideRes.body.id;
    expect(rideRes.body.status).toBe("REQUESTED");

    // --- Driver sees it in their available-rides queue ---
    const availableRes = await request(app)
      .get(`/rides?status=REQUESTED&marketId=${market.id}`)
      .expect(200);
    expect(availableRes.body.map((r: { id: string }) => r.id)).toContain(rideId);

    // --- Driver accepts, starts, and completes the ride ---
    await request(app)
      .post(`/rides/${rideId}/accept`)
      .send({ driverId, vehicleId })
      .expect(200)
      .then((res) => expect(res.body.status).toBe("ACCEPTED"));

    await request(app)
      .post(`/rides/${rideId}/start`)
      .expect(200)
      .then((res) => expect(res.body.status).toBe("IN_PROGRESS"));

    await request(app)
      .post(`/rides/${rideId}/complete`)
      .send({ distanceMiles: 6.2, durationMinutes: 18 })
      .expect(200)
      .then((res) => expect(res.body.status).toBe("COMPLETED"));

    // --- Verify the fare, the driver's earnings, and the Stripe payment ---
    const finalRide = await request(app).get(`/rides/${rideId}`).expect(200);
    expect(finalRide.body.fare).toBeTruthy();
    expect(finalRide.body.fare.riderTotalChargeCents).toBeGreaterThan(0);
    expect(finalRide.body.earningsLines.length).toBeGreaterThan(0);

    expect(finalRide.body.payments).toHaveLength(1);
    const payment = finalRide.body.payments[0];
    expect(payment.status).toBe("CAPTURED");
    expect(payment.method).toBe("STRIPE_CARD");
    expect(payment.amountCents).toBe(finalRide.body.fare.riderTotalChargeCents);
    expect(payment.processorRef).toMatch(/^pi_test_/);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // --- Rider's ride history shows the completed, paid ride ---
    const history = await request(app).get(`/rides?riderId=${riderId}`).expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].status).toBe("COMPLETED");
    expect(history.body[0].payments[0].status).toBe("CAPTURED");

    // --- Driver goes back offline ---
    await request(app).post(`/accounts/drivers/${driverId}/offline`).expect(200);
    const finalStatus = await request(app).get(`/accounts/drivers/${driverId}/status`).expect(200);
    expect(finalStatus.body.online).toBe(false);
  });
});
