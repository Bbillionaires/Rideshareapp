import { LedgerDirection, LedgerPartyType, Ride } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { postLedgerEntry } from "../../lib/ledger";
import { applyRate, sumCents } from "../../lib/money";

const PER_MILE_CENTS = 120;
const PER_MINUTE_CENTS = 25;
const BASE_FARE_CENTS = 250;
const PLATFORM_FEE_RATE = 0.2; // platform's cut of the ride subtotal

/**
 * PRICING module: computes the standard (non-EV, non-sponsored) fare for a
 * completed ride. This is intentionally the ONLY place that decides the
 * rider's base charge and the driver's "standard driver earnings" figure —
 * EV_INCENTIVES and SPONSORSHIPS layer additional amounts on top of
 * driverBaseEarningsCents, they never recompute it.
 */
export async function computeAndPostRideFare(ride: Ride) {
  const existing = await prisma.rideFare.findUnique({ where: { rideId: ride.id } });
  if (existing) return existing;

  const distanceMiles = ride.distanceMiles ? Number(ride.distanceMiles) : 0;
  const durationMinutes = ride.durationMinutes ?? 0;
  const surgeMultiplier = 1.0;

  const distanceFareCents = Math.round(PER_MILE_CENTS * distanceMiles);
  const timeFareCents = Math.round(PER_MINUTE_CENTS * durationMinutes);
  const rawSubtotal = sumCents(BASE_FARE_CENTS, distanceFareCents, timeFareCents);
  const subtotalFareCents = Math.round(rawSubtotal * surgeMultiplier);
  const platformServiceFeeCents = applyRate(subtotalFareCents, PLATFORM_FEE_RATE);
  const driverBaseEarningsCents = subtotalFareCents - platformServiceFeeCents;
  const riderTotalChargeCents = subtotalFareCents;

  const fare = await prisma.$transaction(async (tx) => {
    const created = await tx.rideFare.create({
      data: {
        rideId: ride.id,
        baseFareCents: BASE_FARE_CENTS,
        distanceFareCents,
        timeFareCents,
        surgeMultiplier,
        subtotalFareCents,
        platformServiceFeeCents,
        riderTotalChargeCents,
        driverBaseEarningsCents,
      },
    });

    const riderChargeEntry = await postLedgerEntry(tx, {
      entryType: "RIDE_FARE_RIDER_CHARGE",
      sourceModule: "PRICING",
      direction: LedgerDirection.DEBIT,
      partyType: LedgerPartyType.RIDER,
      partyId: ride.riderId,
      rideId: ride.id,
      amountCents: riderTotalChargeCents,
      description: `Ride fare for ride ${ride.id}`,
    });

    if (ride.driverId) {
      const driverEntry = await postLedgerEntry(tx, {
        entryType: "RIDE_BASE_DRIVER_EARNINGS",
        sourceModule: "PRICING",
        direction: LedgerDirection.CREDIT,
        partyType: LedgerPartyType.DRIVER,
        partyId: ride.driverId,
        driverId: ride.driverId,
        rideId: ride.id,
        amountCents: driverBaseEarningsCents,
        description: `Standard driver earnings for ride ${ride.id}`,
      });
      await tx.driverEarningsLine.create({
        data: {
          driverId: ride.driverId,
          rideId: ride.id,
          lineType: "RIDE_BASE",
          amountCents: driverBaseEarningsCents,
          description: "Standard driver earnings",
          ledgerEntryId: driverEntry.id,
        },
      });
    }

    await postLedgerEntry(tx, {
      entryType: "PLATFORM_SERVICE_FEE",
      sourceModule: "PRICING",
      direction: LedgerDirection.CREDIT,
      partyType: LedgerPartyType.PLATFORM,
      rideId: ride.id,
      amountCents: platformServiceFeeCents,
      description: `Platform service fee for ride ${ride.id}`,
    });

    await tx.riderReceiptLine.create({
      data: {
        rideId: ride.id,
        lineType: "BASE_FARE",
        amountCents: riderTotalChargeCents,
        description: "Ride fare",
        ledgerEntryId: riderChargeEntry.id,
      },
    });

    return created;
  });

  return fare;
}
