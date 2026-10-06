import { PayerType, PaymentStatus, Ride, RideFare } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createPayment } from "./service";
import { createRideFarePaymentIntent, isStripeConfigured } from "./stripe";

/**
 * STRIPE ride-fare settlement: called once per completed ride, after PRICING
 * (and EV_INCENTIVES/SPONSORSHIPS/THERAPY_RIDES completion hooks) have
 * finished posting the ledger. This is deliberately NOT itself a ride
 * completion hook (src/modules/rides/hooks.ts) — those hooks decide what the
 * ride costs; this settles the already-decided base fare against a real
 * (test-mode) card. See docs/API.md and README.md "Status" for the known
 * limitation that this charges RideFare.riderTotalChargeCents only (not any
 * additional rider-funded EV surcharge share or in-ride driver-to-rider
 * product purchases, which post their own separate Payment rows today).
 *
 * Never throws: a Stripe outage or a missing/invalid key must not block ride
 * completion. Three outcomes:
 *   - STRIPE_SECRET_KEY unset: no Payment row is created at all (nothing was
 *     attempted); a warning is logged. This is the expected state in any
 *     environment that hasn't been given a Stripe test key yet.
 *   - Stripe call succeeds: a Payment row is created with status CAPTURED,
 *     method STRIPE_CARD, processorRef = the PaymentIntent id, and rideId set.
 *   - Stripe call throws (bad/revoked key, network error, card error on the
 *     test token, etc.): a Payment row is still created, with status FAILED,
 *     so the failure is visible on the ride (GET /rides/:id includes
 *     `payments`) rather than silently dropped. The error itself is logged
 *     server-side (Payment has no free-text field to store it in).
 */
export async function chargeRideFareWithStripe(ride: Ride, fare: RideFare) {
  if (!isStripeConfigured()) {
    console.warn(
      `STRIPE: STRIPE_SECRET_KEY not set; skipping payment capture for ride ${ride.id}. ` +
        "Set a Stripe TEST secret key (sk_test_...) in the environment to enable ride payments."
    );
    return null;
  }

  let processorRef: string | null = null;
  let status: PaymentStatus = PaymentStatus.FAILED;
  let failureReason: string | null = null;

  try {
    const intent = await createRideFarePaymentIntent({
      rideId: ride.id,
      riderId: ride.riderId,
      amountCents: fare.riderTotalChargeCents,
    });
    processorRef = intent.id;
    status = intent.status === "succeeded" ? PaymentStatus.CAPTURED : PaymentStatus.AUTHORIZED;
  } catch (err) {
    failureReason = err instanceof Error ? err.message : String(err);
    console.error(`STRIPE: payment capture failed for ride ${ride.id}: ${failureReason}`);
  }

  return prisma.$transaction((tx) =>
    createPayment(tx, {
      payerType: PayerType.RIDER,
      payerId: ride.riderId,
      rideId: ride.id,
      amountCents: fare.riderTotalChargeCents,
      method: "STRIPE_CARD",
      status,
      processorRef,
    })
  );
}
