import { prisma } from "../../lib/prisma";
import { computeDriverGroupMetrics, DriverGroupMetrics } from "../pricing/analytics";

/**
 * EV vs non-EV comparison analytics.
 *
 * Grouping logic: a driver falls in the EV group if they currently have at
 * least one active, approved EV vehicle (the same eligibility test used to
 * apply EV bonuses — see eligibility.ts), otherwise they fall in the non-EV
 * group. This is a point-in-time classification of the driver's fleet, used
 * to bucket their aggregated history (earnings, trips, online time, etc.)
 * for comparison — it does not re-derive eligibility per historical ride
 * (that determination already happened at bonus-application time and is
 * captured per-ride in EvBonusLineItem).
 *
 * Callers may optionally scope to one driver (driverId) and/or one market
 * (marketId) and/or a date range (from/to).
 */

export interface EvAnalyticsParams {
  from?: Date;
  to?: Date;
  marketId?: string;
  driverId?: string;
}

export interface EvComparisonGroup extends DriverGroupMetrics {
  /** Sum of ChargingSession.durationMinutes for this group's vehicles — null when not measurable (no sessions logged), and always null for the non-EV group. */
  chargingDowntimeMinutes: number | null;
}

export interface EvComparisonResult {
  from?: Date;
  to?: Date;
  marketId?: string;
  ev: EvComparisonGroup;
  nonEv: EvComparisonGroup;
}

export async function getEvVsNonEvAnalytics(params: EvAnalyticsParams = {}): Promise<EvComparisonResult> {
  const vehicleMarketFilter = params.marketId ? { marketId: params.marketId } : {};

  const evVehicleDrivers = await prisma.vehicle.findMany({
    where: {
      active: true,
      fuelType: "EV",
      approvalStatus: "APPROVED",
      ...vehicleMarketFilter,
      ...(params.driverId ? { driverId: params.driverId } : {}),
    },
    select: { driverId: true },
    distinct: ["driverId"],
  });
  const evDriverIds = evVehicleDrivers.map((v) => v.driverId);
  const evDriverIdSet = new Set(evDriverIds);

  const candidateDrivers = params.driverId
    ? [{ id: params.driverId }]
    : await prisma.driver.findMany({ select: { id: true } });
  const nonEvDriverIds = candidateDrivers.map((d) => d.id).filter((id) => !evDriverIdSet.has(id));

  const range = { from: params.from, to: params.to, marketId: params.marketId };

  const [evMetrics, nonEvMetrics, chargingAgg] = await Promise.all([
    computeDriverGroupMetrics(evDriverIds, range),
    computeDriverGroupMetrics(nonEvDriverIds, range),
    evDriverIds.length > 0
      ? prisma.chargingSession.aggregate({
          _sum: { durationMinutes: true },
          where: {
            vehicle: { driverId: { in: evDriverIds } },
            ...(params.from || params.to
              ? {
                  startedAt: {
                    ...(params.from ? { gte: params.from } : {}),
                    ...(params.to ? { lte: params.to } : {}),
                  },
                }
              : {}),
          },
        })
      : Promise.resolve({ _sum: { durationMinutes: null } }),
  ]);

  return {
    from: params.from,
    to: params.to,
    marketId: params.marketId,
    ev: { ...evMetrics, chargingDowntimeMinutes: chargingAgg._sum.durationMinutes ?? null },
    nonEv: { ...nonEvMetrics, chargingDowntimeMinutes: null },
  };
}
