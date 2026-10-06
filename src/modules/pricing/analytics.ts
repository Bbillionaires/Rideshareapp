import { prisma } from "../../lib/prisma";

/**
 * Generic, EV-agnostic driver/ride metrics used as the building block for
 * comparison analytics (e.g. EV_INCENTIVES' EV vs non-EV report). Lives in
 * PRICING because these are the same figures pricing/earnings reporting
 * needs generally (earnings, trips, online time, utilization) — it has no
 * notion of EV eligibility; callers supply whatever driverId grouping they
 * want compared.
 */

export interface DriverGroupRange {
  from?: Date;
  to?: Date;
  /** Optional market scope, applied to rides and online sessions. */
  marketId?: string;
}

export interface DriverGroupMetrics {
  driverCount: number;
  totalEarningsCents: number;
  avgEarningsCentsPerDriver: number;
  onlineHours: number;
  completedTrips: number;
  totalMiles: number;
  /** ACCEPTED / (ACCEPTED + DECLINED + EXPIRED) across ride offers; null when there is no denominator. */
  acceptanceRate: number | null;
  /** CANCELLED / total rides requested in range; null when there is no denominator. */
  cancellationRate: number | null;
  /** Sum of completed-ride duration hours divided by sum of online hours; null when there is no online time. */
  utilization: number | null;
}

function emptyMetrics(): DriverGroupMetrics {
  return {
    driverCount: 0,
    totalEarningsCents: 0,
    avgEarningsCentsPerDriver: 0,
    onlineHours: 0,
    completedTrips: 0,
    totalMiles: 0,
    acceptanceRate: null,
    cancellationRate: null,
    utilization: null,
  };
}

/** A `{ gte, lte }` filter fragment for a DateTime field, only for bounds that were provided (undefined = no filter). */
function dateRangeFilter(range: DriverGroupRange): { gte?: Date; lte?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

export async function computeDriverGroupMetrics(
  driverIds: string[],
  range: DriverGroupRange = {}
): Promise<DriverGroupMetrics> {
  if (driverIds.length === 0) return emptyMetrics();

  const marketFilter = range.marketId ? { marketId: range.marketId } : {};
  const window = dateRangeFilter(range);

  const [earningsAgg, onlineAgg, completedRides, ridesInRange, offerCounts] = await Promise.all([
    prisma.driverEarningsLine.aggregate({
      _sum: { amountCents: true },
      where: { driverId: { in: driverIds }, createdAt: window },
    }),
    prisma.driverOnlineSession.aggregate({
      _sum: { durationMinutes: true },
      where: { driverId: { in: driverIds }, ...marketFilter, startedAt: window },
    }),
    prisma.ride.findMany({
      where: {
        driverId: { in: driverIds },
        status: "COMPLETED",
        ...marketFilter,
        completedAt: window,
      },
      select: { distanceMiles: true, durationMinutes: true },
    }),
    prisma.ride.findMany({
      where: { driverId: { in: driverIds }, ...marketFilter, requestedAt: window },
      select: { status: true },
    }),
    prisma.rideOffer.groupBy({
      by: ["response"],
      where: { driverId: { in: driverIds }, offeredAt: window },
      _count: { _all: true },
    }),
  ]);

  const totalEarningsCents = earningsAgg._sum.amountCents ?? 0;
  const onlineMinutes = onlineAgg._sum.durationMinutes ?? 0;
  const onlineHours = onlineMinutes / 60;

  const completedTrips = completedRides.length;
  const totalMiles = completedRides.reduce((sum, r) => sum + (r.distanceMiles ? Number(r.distanceMiles) : 0), 0);
  const completedRideMinutes = completedRides.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0);
  const completedRideHours = completedRideMinutes / 60;

  const cancelledCount = ridesInRange.filter((r) => r.status === "CANCELLED").length;
  const totalRidesInRange = ridesInRange.length;
  const cancellationRate = totalRidesInRange > 0 ? cancelledCount / totalRidesInRange : null;

  const countByResponse: Record<string, number> = {};
  for (const row of offerCounts) {
    countByResponse[row.response] = row._count._all;
  }
  const accepted = countByResponse.ACCEPTED ?? 0;
  const declined = countByResponse.DECLINED ?? 0;
  const expired = countByResponse.EXPIRED ?? 0;
  const acceptanceDenominator = accepted + declined + expired;
  const acceptanceRate = acceptanceDenominator > 0 ? accepted / acceptanceDenominator : null;

  const utilization = onlineHours > 0 ? completedRideHours / onlineHours : null;

  return {
    driverCount: driverIds.length,
    totalEarningsCents,
    avgEarningsCentsPerDriver: driverIds.length > 0 ? totalEarningsCents / driverIds.length : 0,
    onlineHours,
    completedTrips,
    totalMiles,
    acceptanceRate,
    cancellationRate,
    utilization,
  };
}
