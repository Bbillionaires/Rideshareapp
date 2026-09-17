import {
  AdCampaign,
  AdCampaignStatus,
  AdCreativeType,
  AdPlacementSlot,
  AdTargetScope,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";

/**
 * ADVERTISING module — admin back-office CRUD for advertisers, campaigns,
 * creatives, placements and targeting rules. Every field listed in the
 * product spec (budget, dates, market/zone/zip targeting, placement,
 * frequency cap, destination URL, promo code, creative assets) is plain
 * data on these models, so back-office changes never require an app-store
 * release — there is no client bundling logic involved here at all.
 */

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

export interface CreateAdvertiserInput {
  name: string;
  contactEmail?: string | null;
}

export async function createAdvertiser(input: CreateAdvertiserInput) {
  if (!input.name) badRequest("name is required");
  return prisma.advertiser.create({
    data: { name: input.name, contactEmail: input.contactEmail ?? null },
  });
}

export async function listAdvertisers() {
  return prisma.advertiser.findMany({ orderBy: { createdAt: "desc" } });
}

export interface UpdateAdvertiserInput {
  name?: string;
  contactEmail?: string | null;
  status?: string;
}

export async function updateAdvertiser(advertiserId: string, input: UpdateAdvertiserInput) {
  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
  if (!advertiser) notFound(`Advertiser ${advertiserId} not found`);
  return prisma.advertiser.update({
    where: { id: advertiserId },
    data: {
      name: input.name,
      contactEmail: input.contactEmail,
      status: input.status,
    },
  });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function getCampaignOrThrow(campaignId: string): Promise<AdCampaign> {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound(`Campaign ${campaignId} not found`);
  return campaign!;
}

/** ARCHIVED is terminal — no further edits of any kind are permitted. */
function assertNotArchived(campaign: AdCampaign) {
  if (campaign.status === AdCampaignStatus.ARCHIVED) {
    badRequest(`Campaign ${campaign.id} is archived and can no longer be edited`);
  }
}

export interface CreateCampaignInput {
  advertiserId: string;
  name: string;
  budgetTotalCents: number;
  startDate: string | Date;
  endDate?: string | Date | null;
  destinationUrl?: string | null;
  promoCode?: string | null;
  createdBy?: string | null;
}

export async function createCampaign(input: CreateCampaignInput) {
  if (!input.advertiserId) badRequest("advertiserId is required");
  if (!input.name) badRequest("name is required");
  if (!Number.isInteger(input.budgetTotalCents) || input.budgetTotalCents <= 0) {
    badRequest("budgetTotalCents must be a positive integer");
  }
  if (!input.startDate) badRequest("startDate is required");

  const advertiser = await prisma.advertiser.findUnique({ where: { id: input.advertiserId } });
  if (!advertiser) notFound(`Advertiser ${input.advertiserId} not found`);

  return prisma.adCampaign.create({
    data: {
      advertiserId: input.advertiserId,
      name: input.name,
      budgetTotalCents: input.budgetTotalCents,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      destinationUrl: input.destinationUrl ?? null,
      promoCode: input.promoCode ?? null,
      createdBy: input.createdBy ?? null,
      status: AdCampaignStatus.DRAFT,
    },
  });
}

export async function listCampaigns(filter?: { advertiserId?: string }) {
  return prisma.adCampaign.findMany({
    where: filter?.advertiserId ? { advertiserId: filter.advertiserId } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(campaignId: string) {
  const campaign = await prisma.adCampaign.findUnique({
    where: { id: campaignId },
    include: { creatives: true, placements: true, targetRules: true },
  });
  if (!campaign) notFound(`Campaign ${campaignId} not found`);
  return campaign;
}

export interface EditCampaignInput {
  name?: string;
  budgetTotalCents?: number;
  startDate?: string | Date;
  endDate?: string | Date | null;
  destinationUrl?: string | null;
  promoCode?: string | null;
}

/** Edits any editable field on the campaign (name, budget, dates, URL, promo code). */
export async function editCampaign(campaignId: string, input: EditCampaignInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);

  if (
    input.budgetTotalCents !== undefined &&
    (!Number.isInteger(input.budgetTotalCents) || input.budgetTotalCents <= 0)
  ) {
    badRequest("budgetTotalCents must be a positive integer");
  }

  return prisma.adCampaign.update({
    where: { id: campaignId },
    data: {
      name: input.name,
      budgetTotalCents: input.budgetTotalCents,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate === undefined ? undefined : input.endDate ? new Date(input.endDate) : null,
      destinationUrl: input.destinationUrl,
      promoCode: input.promoCode,
    },
  });
}

export async function pauseCampaign(campaignId: string) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  return prisma.adCampaign.update({
    where: { id: campaignId },
    data: { status: AdCampaignStatus.PAUSED },
  });
}

/** Only DRAFT or PAUSED campaigns may be activated. */
export async function activateCampaign(campaignId: string) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  if (campaign.status !== AdCampaignStatus.DRAFT && campaign.status !== AdCampaignStatus.PAUSED) {
    badRequest(`Campaign ${campaignId} must be DRAFT or PAUSED to activate (is ${campaign.status})`);
  }
  return prisma.adCampaign.update({
    where: { id: campaignId },
    data: { status: AdCampaignStatus.ACTIVE },
  });
}

/** Terminal state — archived campaigns reject all further edits (assertNotArchived). */
export async function archiveCampaign(campaignId: string) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  return prisma.adCampaign.update({
    where: { id: campaignId },
    data: { status: AdCampaignStatus.ARCHIVED },
  });
}

export interface SetFrequencyCapInput {
  frequencyCapCount: number | null;
  frequencyCapPeriod: string | null; // e.g. "DAILY" | "CAMPAIGN"
}

export async function setFrequencyCap(campaignId: string, input: SetFrequencyCapInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  if (input.frequencyCapCount !== null && input.frequencyCapCount !== undefined) {
    if (!Number.isInteger(input.frequencyCapCount) || input.frequencyCapCount <= 0) {
      badRequest("frequencyCapCount must be a positive integer or null");
    }
    if (!input.frequencyCapPeriod) {
      badRequest("frequencyCapPeriod is required when frequencyCapCount is set");
    }
  }
  return prisma.adCampaign.update({
    where: { id: campaignId },
    data: {
      frequencyCapCount: input.frequencyCapCount ?? null,
      frequencyCapPeriod: input.frequencyCapPeriod ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

export interface CreativeInput {
  type: AdCreativeType;
  assetUrl: string;
  headline?: string | null;
  bodyText?: string | null;
  ctaLabel?: string | null;
}

function assertValidCreativeInput(input: CreativeInput) {
  if (!input.type) badRequest("type is required");
  if (!input.assetUrl) badRequest("assetUrl is required (image/video upload URL)");
}

/**
 * Adds a creative to a campaign. Distinct from replaceCreative below: this
 * simply appends a new versioned creative row (e.g. for A/B variants) and
 * does not touch the active state of any other creative on the campaign.
 */
export async function addCreative(campaignId: string, input: CreativeInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  assertValidCreativeInput(input);

  const maxVersion = await prisma.adCreative.aggregate({
    where: { campaignId },
    _max: { version: true },
  });

  return prisma.adCreative.create({
    data: {
      campaignId,
      type: input.type,
      assetUrl: input.assetUrl,
      headline: input.headline ?? null,
      bodyText: input.bodyText ?? null,
      ctaLabel: input.ctaLabel ?? null,
      version: (maxVersion._max.version ?? 0) + 1,
      active: true,
    },
  });
}

/**
 * "Replace creative": creates a new AdCreative row (version = previous max +
 * 1, active = true) and deactivates the campaign's previously active
 * creative(s). The old row is never deleted or mutated beyond active=false —
 * full creative history is preserved for auditing.
 */
export async function replaceCreative(campaignId: string, input: CreativeInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  assertValidCreativeInput(input);

  return prisma.$transaction(async (tx) => {
    const maxVersion = await tx.adCreative.aggregate({
      where: { campaignId },
      _max: { version: true },
    });

    await tx.adCreative.updateMany({
      where: { campaignId, active: true },
      data: { active: false },
    });

    return tx.adCreative.create({
      data: {
        campaignId,
        type: input.type,
        assetUrl: input.assetUrl,
        headline: input.headline ?? null,
        bodyText: input.bodyText ?? null,
        ctaLabel: input.ctaLabel ?? null,
        version: (maxVersion._max.version ?? 0) + 1,
        active: true,
      },
    });
  });
}

export async function listCreatives(campaignId: string) {
  return prisma.adCreative.findMany({
    where: { campaignId },
    orderBy: { version: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Placements
//
// AdPlacementSlot is a fixed, closed enum (see schema.prisma) precisely so
// advertising can never be wired onto a safety-critical surface such as
// navigation, emergency controls, driver identification, or trip controls —
// admins may only choose among the pre-approved slots below, never invent
// a new placement concept.
// ---------------------------------------------------------------------------

export interface SetPlacementInput {
  placement: AdPlacementSlot;
  priority?: number;
}

export async function setPlacement(campaignId: string, input: SetPlacementInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  if (!input.placement) badRequest("placement is required");

  return prisma.adCampaignPlacement.upsert({
    where: { campaignId_placement: { campaignId, placement: input.placement } },
    create: { campaignId, placement: input.placement, priority: input.priority ?? 0 },
    update: { priority: input.priority ?? 0 },
  });
}

export async function removePlacement(campaignId: string, placement: AdPlacementSlot) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  await prisma.adCampaignPlacement.deleteMany({ where: { campaignId, placement } });
}

export async function listPlacements(campaignId: string) {
  return prisma.adCampaignPlacement.findMany({ where: { campaignId } });
}

// ---------------------------------------------------------------------------
// Target rules
//
// A campaign matches a viewer if ANY of its target rules match (OR across
// rules) — see targeting.service.ts for the matching logic used at serve
// time. Required fields differ per scope; validated here so a malformed
// rule can never be saved.
// ---------------------------------------------------------------------------

export interface AddTargetRuleInput {
  scope: AdTargetScope;
  marketId?: string | null;
  zoneId?: string | null;
  zip?: string | null;
  radiusCenterLat?: number | null;
  radiusCenterLng?: number | null;
  radiusMiles?: number | null;
}

function assertValidTargetRuleInput(input: AddTargetRuleInput) {
  switch (input.scope) {
    case AdTargetScope.ENTIRE_MARKET:
      if (!input.marketId) badRequest("marketId is required for ENTIRE_MARKET scope");
      break;
    case AdTargetScope.ZONE:
      if (!input.marketId || !input.zoneId) {
        badRequest("marketId and zoneId are required for ZONE scope");
      }
      break;
    case AdTargetScope.ZIP:
      if (!input.zip) badRequest("zip is required for ZIP scope");
      break;
    case AdTargetScope.RADIUS:
      if (
        input.radiusCenterLat === undefined ||
        input.radiusCenterLat === null ||
        input.radiusCenterLng === undefined ||
        input.radiusCenterLng === null ||
        input.radiusMiles === undefined ||
        input.radiusMiles === null
      ) {
        badRequest("radiusCenterLat, radiusCenterLng and radiusMiles are required for RADIUS scope");
      }
      break;
    default:
      badRequest(`Unknown target scope: ${input.scope}`);
  }
}

export async function addTargetRule(campaignId: string, input: AddTargetRuleInput) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  assertValidTargetRuleInput(input);

  return prisma.adTargetRule.create({
    data: {
      campaignId,
      scope: input.scope,
      marketId: input.marketId ?? null,
      zoneId: input.zoneId ?? null,
      zip: input.zip ?? null,
      radiusCenterLat: input.radiusCenterLat ?? null,
      radiusCenterLng: input.radiusCenterLng ?? null,
      radiusMiles: input.radiusMiles ?? null,
    },
  });
}

export async function removeTargetRule(campaignId: string, ruleId: string) {
  const campaign = await getCampaignOrThrow(campaignId);
  assertNotArchived(campaign);
  const rule = await prisma.adTargetRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.campaignId !== campaignId) {
    notFound(`Target rule ${ruleId} not found on campaign ${campaignId}`);
  }
  await prisma.adTargetRule.delete({ where: { id: ruleId } });
}

export async function listTargetRules(campaignId: string) {
  return prisma.adTargetRule.findMany({ where: { campaignId } });
}
