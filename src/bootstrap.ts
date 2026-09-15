/**
 * Cross-module wiring root. RIDES must not import EV_INCENTIVES or
 * SPONSORSHIPS directly (that would invert the bounded-module boundary), so
 * those modules instead register themselves against src/modules/rides/hooks.ts
 * as a side effect of being imported here, in the order they must run.
 *
 * Import this once, before the HTTP app starts serving traffic.
 */
import "./modules/ev-incentives/register";
