import { CancelledBy, RideStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { computeAndPostRideFare } from "../pricing/service";
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
  await computeAndPostRideFare(ride);
  await runRideCompletionHooks(ride);

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
    },
  });
  if (!ride) notFound(`Ride ${rideId} not found`);
  return ride;
}
