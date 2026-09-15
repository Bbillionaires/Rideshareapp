import { Ride } from "@prisma/client";

/**
 * Ride completion is the point where PRICING, EV_INCENTIVES, and
 * SPONSORSHIPS all need to act, but RIDES must not import those modules
 * directly (that would invert the bounded-module boundary). Instead each
 * module registers a hook here, and a composition root (src/bootstrap.ts)
 * wires them up in the right order: pricing first (it establishes
 * driverBaseEarningsCents), then EV incentives, then sponsorships.
 */
type RideCompletionHook = (ride: Ride) => Promise<void>;

const hooks: RideCompletionHook[] = [];

export function registerRideCompletionHook(hook: RideCompletionHook) {
  hooks.push(hook);
}

export async function runRideCompletionHooks(ride: Ride) {
  for (const hook of hooks) {
    await hook(ride);
  }
}
