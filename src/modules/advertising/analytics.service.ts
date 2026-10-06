import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/http";

/**
 * ADVERTISING analytics — every query here returns aggregated counts/sums
 * only. Advertisers must never be able to see which specific riders/drivers
 * were served an ad or their raw locations: no function in this file
 * returns a per-viewer row, only group counts (by campaign, zone, or zip).
 */

export interface CampaignAnalytics {
  campaignId: string;
  impressions: number;
  uniqueImpressions: number;
  clicks: number;
  ctr: number;
  conversions: { total: number; byType: { conversionType: string; count: number; amountCents: number }[] };
  promoCodeRedemptions: number;
  spendCents: number;
  budgetTotalCents: number;
  remainingBudgetCents: number;
}

export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound(`Campaign ${campaignId} not found`);

  const [impressions, uniqueViewerGroups, clicks, conversionGroups, conversionTotal, promoCodeRedemptions] =
    await Promise.all([
      prisma.adImpression.count({ where: { campaignId } }),
      prisma.adImpression.groupBy({ by: ["viewerId"], where: { campaignId } }),
      prisma.adClick.count({ where: { campaignId } }),
      prisma.adConversion.groupBy({
        by: ["conversionType"],
        where: { campaignId },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.adConversion.count({ where: { campaignId } }),
      prisma.promoCodeRedemption.count({ where: { campaignId } }),
    ]);

  return {
    campaignId,
    impressions,
    uniqueImpressions: uniqueViewerGroups.length,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0,
    conversions: {
      total: conversionTotal,
      byType: conversionGroups.map((g) => ({
        conversionType: g.conversionType,
        count: g._count._all,
        amountCents: g._sum.amountCents ?? 0,
      })),
    },
    promoCodeRedemptions,
    spendCents: campaign!.budgetSpentCents,
    budgetTotalCents: campaign!.budgetTotalCents,
    remainingBudgetCents: campaign!.budgetTotalCents - campaign!.budgetSpentCents,
  };
}

export interface GeoPerformanceRow {
  key: string; // zoneId or zip
  impressions: number;
  clicks: number;
  ctr: number;
}

/**
 * Zone performance: impressions/clicks/CTR grouped by zoneId. Impression and
 * click rows are only ever used here to compute aggregate counts — this
 * function never returns the underlying viewerId list.
 */
export async function getZonePerformance(campaignId: string): Promise<GeoPerformanceRow[]> {
  return getGeoPerformance(campaignId, "zoneId");
}

/** ZIP performance: same aggregation as getZonePerformance, grouped by zip. */
export async function getZipPerformance(campaignId: string): Promise<GeoPerformanceRow[]> {
  return getGeoPerformance(campaignId, "zip");
}

async function getGeoPerformance(
  campaignId: string,
  field: "zoneId" | "zip"
): Promise<GeoPerformanceRow[]> {
  const [impressions, clickRows] = await Promise.all([
    prisma.adImpression.findMany({
      where: { campaignId },
      select: { id: true, zoneId: true, zip: true },
    }),
    prisma.adClick.findMany({
      where: { campaignId },
      select: { impressionId: true },
    }),
  ]);

  const keyOf = (row: { zoneId: string | null; zip: string | null }): string | null =>
    field === "zoneId" ? row.zoneId : row.zip;

  const impressionKeyById = new Map<string, string>();
  const impressionCountByKey = new Map<string, number>();
  for (const row of impressions) {
    const key = keyOf(row);
    if (!key) continue;
    impressionKeyById.set(row.id, key);
    impressionCountByKey.set(key, (impressionCountByKey.get(key) ?? 0) + 1);
  }

  const clickCountByKey = new Map<string, number>();
  for (const click of clickRows) {
    const key = impressionKeyById.get(click.impressionId);
    if (!key) continue;
    clickCountByKey.set(key, (clickCountByKey.get(key) ?? 0) + 1);
  }

  return Array.from(impressionCountByKey.entries()).map(([key, impressionCount]) => {
    const clickCount = clickCountByKey.get(key) ?? 0;
    return {
      key,
      impressions: impressionCount,
      clicks: clickCount,
      ctr: impressionCount > 0 ? clickCount / impressionCount : 0,
    };
  });
}
