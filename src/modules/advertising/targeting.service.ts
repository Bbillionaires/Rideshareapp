import {
  AdCampaign,
  AdCampaignStatus,
  AdPlacementSlot,
  AdTargetRule,
  AdTargetScope,
  AdViewerType,
  LedgerDirection,
  LedgerPartyType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { PrismaTx } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { postLedgerEntry } from "../../lib/ledger";

// ---------------------------------------------------------------------------
// Ad serving
// ---------------------------------------------------------------------------

export interface ResolveEligibleCampaignsInput {
  placement: AdPlacementSlot;
  viewerType: AdViewerType;
  viewerId: string;
  marketId?: string | null;
  zoneId?: string | null;
  zip?: string | null;
  /** Only usable for RADIUS rule matching; frequently unavailable — see below. */
  viewerLat?: number | null;
  viewerLng?: number | null;
  /**
   * Computed by the CALLER via ad-consent's hasPersonalizedAdConsent (this
   * module — ADVERTISING — may depend on AD_CONSENT, never the reverse, so
   * it never imports or queries AdConsentRecord itself). When omitted or
   * false, only ENTIRE_MARKET target rules (broad, non-personalized) match;
   * ZONE/ZIP/RADIUS rules all target the viewer's specific location and so
   * require personalized consent to match. Absence of consent is treated as
   * NOT consented (fail closed), consistent with AD_CONSENT's own contract.
   */
  hasPersonalizedConsent?: boolean;
}

/**
 * The core ad-serving query.
 *
 * `placement` is deliberately a fixed, closed enum (AdPlacementSlot) so ad
 * content can never be substituted onto a safety-critical surface —
 * navigation, emergency controls, driver identification, or trip controls
 * are simply not members of the enum and never will be. Callers should also
 * treat every result here as an informational ad slot only: serving a
 * campaign for a placement never takes over, blocks, or replaces any
 * trip-control screen or safety-critical information.
 */
export async function resolveEligibleCampaigns(
  input: ResolveEligibleCampaignsInput
): Promise<AdCampaign[]> {
  const now = new Date();
  const personalizedConsent = input.hasPersonalizedConsent === true;

  const candidates = await prisma.adCampaign.findMany({
    where: {
      status: AdCampaignStatus.ACTIVE,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
      placements: { some: { placement: input.placement } },
    },
    include: { targetRules: true },
  });

  const withBudget = candidates.filter((c) => c.budgetSpentCents < c.budgetTotalCents);

  const withMatchingTarget = withBudget.filter((c) =>
    c.targetRules.some((rule) =>
      targetRuleMatches(rule, {
        marketId: input.marketId ?? null,
        zoneId: input.zoneId ?? null,
        zip: input.zip ?? null,
        viewerLat: input.viewerLat ?? null,
        viewerLng: input.viewerLng ?? null,
        personalizedConsent,
      })
    )
  );

  const withinFrequencyCap = await filterByFrequencyCap(withMatchingTarget, input.viewerId, now);

  return withinFrequencyCap;
}

interface ViewerLocation {
  marketId: string | null;
  zoneId: string | null;
  zip: string | null;
  viewerLat: number | null;
  viewerLng: number | null;
  personalizedConsent: boolean;
}

function targetRuleMatches(rule: AdTargetRule, viewer: ViewerLocation): boolean {
  switch (rule.scope) {
    case AdTargetScope.ENTIRE_MARKET:
      // Broad, non-personalized — always allowed regardless of consent.
      return rule.marketId !== null && rule.marketId === viewer.marketId;

    case AdTargetScope.ZONE:
      // Targets the viewer's specific zone — requires personalized consent.
      if (!viewer.personalizedConsent) return false;
      return (
        rule.marketId !== null &&
        rule.marketId === viewer.marketId &&
        rule.zoneId !== null &&
        rule.zoneId === viewer.zoneId
      );

    case AdTargetScope.ZIP:
      // Targets the viewer's specific ZIP — requires personalized consent.
      if (!viewer.personalizedConsent) return false;
      return rule.zip !== null && rule.zip === viewer.zip;

    case AdTargetScope.RADIUS: {
      // Targets the viewer's specific coordinates — requires personalized
      // consent. Also requires viewer lat/lng, which this viewer-context
      // call may not have; if absent, silently skip RADIUS rules rather
      // than throwing (documented limitation, not an error).
      if (!viewer.personalizedConsent) return false;
      if (viewer.viewerLat === null || viewer.viewerLng === null) return false;
      if (rule.radiusCenterLat === null || rule.radiusCenterLng === null || rule.radiusMiles === null) {
        return false;
      }
      const distanceMiles = haversineMiles(
        viewer.viewerLat,
        viewer.viewerLng,
        Number(rule.radiusCenterLat),
        Number(rule.radiusCenterLng)
      );
      return distanceMiles <= Number(rule.radiusMiles);
    }

    default:
      return false;
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMiles = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return earthRadiusMiles * c;
}

/**
 * Respects each campaign's frequency cap: DAILY = impressions to this viewer
 * in the last 24h, CAMPAIGN = all-time. Campaigns with no cap configured
 * always pass. Excludes campaigns already at/over frequencyCapCount.
 */
async function filterByFrequencyCap<T extends AdCampaign>(
  campaigns: T[],
  viewerId: string,
  now: Date
): Promise<T[]> {
  const results: Array<T | null> = await Promise.all(
    campaigns.map(async (campaign): Promise<T | null> => {
      if (!campaign.frequencyCapCount) return campaign;

      const since =
        campaign.frequencyCapPeriod === "DAILY"
          ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
          : undefined; // CAMPAIGN (or unset period with a count set) = all-time

      const impressionCount = await prisma.adImpression.count({
        where: {
          campaignId: campaign.id,
          viewerId,
          occurredAt: since ? { gte: since } : undefined,
        },
      });

      return impressionCount < campaign.frequencyCapCount ? campaign : null;
    })
  );

  return results.filter((c): c is T => c !== null);
}

// ---------------------------------------------------------------------------
// Impressions / clicks / conversions / promo redemptions
// ---------------------------------------------------------------------------

export interface RecordImpressionInput {
  campaignId: string;
  creativeId: string;
  placement: AdPlacementSlot;
  viewerType: AdViewerType;
  viewerId: string;
  marketId?: string | null;
  zoneId?: string | null;
  zip?: string | null;
}

export async function recordImpression(input: RecordImpressionInput) {
  const priorCount = await prisma.adImpression.count({
    where: { campaignId: input.campaignId, viewerId: input.viewerId },
  });

  return prisma.adImpression.create({
    data: {
      campaignId: input.campaignId,
      creativeId: input.creativeId,
      placement: input.placement,
      viewerType: input.viewerType,
      viewerId: input.viewerId,
      marketId: input.marketId ?? null,
      zoneId: input.zoneId ?? null,
      zip: input.zip ?? null,
      isUniqueForViewer: priorCount === 0,
    },
  });
}

export async function recordClick(impressionId: string) {
  const impression = await prisma.adImpression.findUnique({ where: { id: impressionId } });
  if (!impression) notFound(`Impression ${impressionId} not found`);

  return prisma.adClick.create({
    data: {
      impressionId,
      campaignId: impression!.campaignId,
    },
  });
}

export interface RecordConversionInput {
  campaignId: string;
  conversionType: string; // e.g. PROMO_CODE_REDEEMED, SIGNUP, PURCHASE
  referenceId?: string | null;
  amountCents?: number | null;
}

export async function recordConversion(input: RecordConversionInput) {
  if (!input.conversionType) badRequest("conversionType is required");
  return prisma.adConversion.create({
    data: {
      campaignId: input.campaignId,
      conversionType: input.conversionType,
      referenceId: input.referenceId ?? null,
      amountCents: input.amountCents ?? null,
    },
  });
}

export interface RedeemPromoCodeInput {
  campaignId: string;
  promoCode: string;
  userId: string;
  userType: AdViewerType;
  referenceId?: string | null;
}

export async function redeemPromoCode(input: RedeemPromoCodeInput) {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) notFound(`Campaign ${input.campaignId} not found`);
  if (!campaign!.promoCode || campaign!.promoCode !== input.promoCode) {
    badRequest(`Promo code does not match campaign ${input.campaignId}`);
  }

  return prisma.promoCodeRedemption.create({
    data: {
      campaignId: input.campaignId,
      promoCode: input.promoCode,
      userId: input.userId,
      userType: input.userType,
      referenceId: input.referenceId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Billing (spend / revenue)
//
// Neither of these is invoked automatically by recordImpression above: the
// spec leaves the actual billing model (e.g. cost-per-mille, cost-per-click,
// a flat monthly rate) undefined, and inventing a rate here would be a
// product decision, not a plumbing one. Both functions are provided fully
// wired and ready to be called from whichever future billing job (or, in
// the interim, the manual admin "record spend" route in routes.ts) decides
// how much a campaign owes for the activity it received.
// ---------------------------------------------------------------------------

/**
 * Increments AdCampaign.budgetSpentCents and posts the advertiser-side debit
 * of a spend event (e.g. billing for a batch of impressions/clicks).
 */
export async function recordCampaignSpend(
  tx: PrismaTx,
  campaignId: string,
  amountCents: number,
  description: string
) {
  const campaign = await tx.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound(`Campaign ${campaignId} not found`);

  await tx.adCampaign.update({
    where: { id: campaignId },
    data: { budgetSpentCents: { increment: amountCents } },
  });

  return postLedgerEntry(tx, {
    entryType: "AD_CAMPAIGN_SPEND",
    sourceModule: "ADVERTISING",
    direction: LedgerDirection.DEBIT,
    partyType: LedgerPartyType.ADVERTISER,
    partyId: campaign!.advertiserId,
    adCampaignId: campaignId,
    amountCents,
    description,
  });
}

/**
 * Posts the platform's revenue-side credit for the same spend event. Kept
 * as a separate call (rather than folded into recordCampaignSpend) so a
 * caller can post spend without necessarily recognizing it as platform
 * revenue in the same moment, though in practice these are usually called
 * together — see routes.ts's manual "record spend" admin endpoint.
 */
export async function recordAdRevenue(
  tx: PrismaTx,
  campaignId: string,
  amountCents: number,
  description: string
) {
  return postLedgerEntry(tx, {
    entryType: "AD_REVENUE",
    sourceModule: "ADVERTISING",
    direction: LedgerDirection.CREDIT,
    partyType: LedgerPartyType.PLATFORM,
    adCampaignId: campaignId,
    amountCents,
    description,
  });
}
