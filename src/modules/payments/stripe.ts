import Stripe from "stripe";

/**
 * Thin Stripe wrapper, test-mode only. Nothing in this file ever switches
 * Stripe into live mode: the key itself determines that (a real `sk_live_...`
 * key would work here too, which is exactly why callers must only ever put a
 * `sk_test_...` key in STRIPE_SECRET_KEY in this codebase — see .env.example
 * and docs/API.md).
 *
 * The secret key is read from the environment on every call rather than
 * cached at import time, so (a) a process that starts without the key set
 * can still pick it up without a restart, and (b) tests can toggle it
 * between cases.
 */

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Payments are disabled until a Stripe TEST secret key " +
        "(sk_test_...) is provided via the environment — see .env.example."
    );
  }
  return new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
}

export interface CreateRideFarePaymentIntentInput {
  rideId: string;
  riderId: string;
  amountCents: number;
  currency?: string;
}

/**
 * Creates and immediately confirms a PaymentIntent for a ride's fare, using
 * Stripe's built-in "always succeeds" test payment method token
 * (`pm_card_visa`). This only ever works against a test-mode secret key —
 * Stripe rejects test payment method tokens outright against a live key —
 * which is a second, Stripe-enforced guarantee (on top of only ever reading
 * a test key from the environment) that this never charges a real card.
 */
export async function createRideFarePaymentIntent(
  input: CreateRideFarePaymentIntentInput
): Promise<Stripe.PaymentIntent> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`amountCents must be a positive integer, got ${input.amountCents}`);
  }
  const stripe = getStripeClient();
  return stripe.paymentIntents.create({
    amount: input.amountCents,
    currency: (input.currency ?? "usd").toLowerCase(),
    payment_method_types: ["card"],
    payment_method: "pm_card_visa",
    confirm: true,
    description: `Ride fare for ride ${input.rideId}`,
    metadata: { rideId: input.rideId, riderId: input.riderId },
  });
}
