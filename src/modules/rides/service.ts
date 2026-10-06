import { CancelledBy, RideStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { computeAndPostRideFare } from "../pricing/service";
import { chargeRideFareWithStripe } from "../payments/ride-fare-payment";
import { runRideCompletionHooks } from "./hooks";

export async function requestRide(input: {
  riderId: string;
  marketId: string;
  serviceTypeId: string;
  zoneId?: string;
  pickupZip?: string;
}) {
  return prisma.ride.create({
    data: {
      riderId: input.riderId,
      marketId: input.marketId,
      serviceTypeId: input.serviceTypeId,
      zoneId: input.zoneId,
      pickupZip: input.pickupZip,
      status: RideStatus.REQUESTED,
    },
  });
}

export async function acceptRide(rideId: string, driverId: string, vehicleId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) notFound(`Ride ${rideId} not found`);
  if (ride!.status !== RideStatus.REQUESTED) {
    badRequest(`Ride ${rideId} is not in REQUESTED state`);
  }
  return prisma.ride.update({
    where: { id: rideId },
    data: { driverId, vehicleId, status: RideStatus.ACCEPTED, acceptedAt: new Date() },
  });
}

export async function startRide(rideId: string) {
  return prisma.ride.update({
    where: { id: rideId },
    data: { status: RideStatus.IN_PROGRESS, startedAt: new Date() },
  });
}

export async function completeRide(
  rideId: string,
  input: { distanceMiles: number; durationMinutes: number }
) {
  const ride = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status: RideStatus.COMPLETED,
      completedAt: new Date(),
      distanceMiles: input.distanceMiles,
      durationMinutes: input.durationMinutes,
    },
  });

  // PRICING always runs first: it establishes driverBaseEarningsCents, which
  // EV_INCENTIVES and SPONSORSHIPS hooks below read and add to.
  const fare = await computeAndPostRideFare(ride);
  await runRideCompletionHooks(ride);

  // STRIPE (test-mode only): settles the rider's charge for the base fare.
  // Never allowed to fail ride completion itself — see ride-fare-payment.ts.
  try {
    await chargeRideFareWithStripe(ride, fare);
  } catch (err) {
    console.error(`STRIPE: unexpected error settling payment for ride ${ride.id}:`, err);
  }

  return ride;
}

export async function cancelRide(rideId: string, cancelledBy: CancelledBy, reason?: string) {
  return prisma.ride.update({
    where: { id: rideId },
    data: {
      status: RideStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy,
      cancelReason: reason,
    },
  });
}

export async function getRide(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      fare: true,
      evBonusLineItems: true,
      sponsorContribs: true,
      driverSales: true,
      receiptLines: true,
      earningsLines: true,
      payments: true,
    },
  });
  if (!ride) notFound(`Ride ${rideId} not found`);
  return ride;
}

/**
 * Powers both the rider "ride history" view (riderId filter) and the driver
 * "available rides" view (status=REQUESTED + marketId filter) — there's no
 * separate dispatch/matching queue in this MVP, so a driver going online
 * simply polls this with status=REQUESTED for their market.
 */
export async function listRides(filters: {
  riderId?: string;
  driverId?: string;
  marketId?: string;
  status?: RideStatus;
  limit?: number;
}) {
  const take = filters.limit && filters.limit > 0 && filters.limit <= 100 ? filters.limit : 50;
  return prisma.ride.findMany({
    where: {
      riderId: filters.riderId,
      driverId: filters.driverId,
      marketId: filters.marketId,
      status: filters.status,
    },
    include: { fare: true, payments: true },
    orderBy: { requestedAt: "desc" },
    take,
  });
}
