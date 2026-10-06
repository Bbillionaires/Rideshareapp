// Mocks the `stripe` package so this suite never makes a real network call —
// it exercises our own PaymentIntent-creation/error-handling logic only, not
// Stripe's actual test-mode infrastructure (see docs/API.md's Stripe section
// for how that's verified separately).
const mockCreate = jest.fn();
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockCreate },
  }));
});

import { prisma } from "../../src/lib/prisma";
import { chargeRideFareWithStripe } from "../../src/modules/payments/ride-fare-payment";
import { computeAndPostRideFare } from "../../src/modules/pricing/service";
import {
  createCompletedRide,
  createTestDriver,
  createTestRider,
  disconnectDatabase,
  resetDatabase,
  seedBaseline,
} from "../helpers/db";

describe("PAYMENTS — Stripe ride-fare settlement (test mode, mocked)", () => {
  const ORIGINAL_ENV = process.env.STRIPE_SECRET_KEY;

  afterAll(async () => {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_ENV;
    await disconnectDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    mockCreate.mockReset();
  });

  async function setupRideAndFare() {
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
    const fare = await prisma.rideFare.create({
      data: {
        rideId: ride.id,
        baseFareCents: 250,
        distanceFareCents: 600,
        timeFareCents: 375,
        surgeMultiplier: 1,
        subtotalFareCents: 1225,
        platformServiceFeeCents: 245,
        riderTotalChargeCents: 1225,
        driverBaseEarningsCents: 980,
      },
    });
    return { ride, fare };
  }

  it("does nothing (no Payment row) when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { ride, fare } = await setupRideAndFare();

    const result = await chargeRideFareWithStripe(ride, fare);

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    const payments = await prisma.payment.findMany({ where: { rideId: ride.id } });
    expect(payments).toHaveLength(0);
  });

  it("records a CAPTURED payment with the PaymentIntent id when Stripe succeeds", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    mockCreate.mockResolvedValue({ id: "pi_test_123", status: "succeeded" });
    const { ride, fare } = await setupRideAndFare();

    const payment = await chargeRideFareWithStripe(ride, fare);

    expect(payment).not.toBeNull();
    expect(payment!.status).toBe("CAPTURED");
    expect(payment!.processorRef).toBe("pi_test_123");
    expect(payment!.rideId).toBe(ride.id);
    expect(payment!.amountCents).toBe(fare.riderTotalChargeCents);
    expect(payment!.method).toBe("STRIPE_CARD");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: fare.riderTotalChargeCents,
        currency: "usd",
        payment_method: "pm_card_visa",
        confirm: true,
      })
    );
  });

  it("records a FAILED payment (and never throws) when the Stripe call rejects", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    mockCreate.mockRejectedValue(new Error("Your card was declined (simulated)."));
    const { ride, fare } = await setupRideAndFare();

    const payment = await chargeRideFareWithStripe(ride, fare);

    expect(payment).not.toBeNull();
    expect(payment!.status).toBe("FAILED");
    expect(payment!.processorRef).toBeNull();
    expect(payment!.rideId).toBe(ride.id);
  });

  it("settling with Stripe after PRICING adds exactly one Payment row and zero extra ledger entries", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    mockCreate.mockResolvedValue({ id: "pi_test_456", status: "succeeded" });

    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    const fare = await computeAndPostRideFare(ride); // PRICING posts its 3 ledger entries here

    const ledgerEntriesAfterPricing = await prisma.ledgerEntry.findMany({ where: { rideId: ride.id } });
    expect(ledgerEntriesAfterPricing).toHaveLength(3);

    await chargeRideFareWithStripe(ride, fare);

    const ledgerEntriesAfterStripe = await prisma.ledgerEntry.findMany({ where: { rideId: ride.id } });
    expect(ledgerEntriesAfterStripe).toHaveLength(3); // unchanged — settlement never posts its own ledger entry
    const payments = await prisma.payment.findMany({ where: { rideId: ride.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amountCents).toBe(fare.riderTotalChargeCents);
  });
});
