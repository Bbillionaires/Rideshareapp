import { Router } from "express";
import { AdPlacementSlot, AdViewerType } from "@prisma/client";
import { asyncHandler, badRequest } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import * as CampaignService from "./campaign.service";
import * as TargetingService from "./targeting.service";
import * as AnalyticsService from "./analytics.service";
// ADVERTISING may depend on AD_CONSENT (never the reverse — see
// ad-consent/service.ts). Used below to compute personalized-consent
// server-side rather than trusting a client-supplied flag.
import { hasPersonalizedAdConsent } from "../ad-consent/service";

export const advertisingRouter = Router();

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

advertisingRouter.post(
  "/advertisers",
  asyncHandler(async (req, res) => {
    const advertiser = await CampaignService.createAdvertiser(req.body);
    res.status(201).json(advertiser);
  })
);

advertisingRouter.get(
  "/advertisers",
  asyncHandler(async (_req, res) => {
    res.json(await CampaignService.listAdvertisers());
  })
);

advertisingRouter.patch(
  "/advertisers/:id",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.updateAdvertiser(req.params.id, req.body));
  })
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

advertisingRouter.post(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const campaign = await CampaignService.createCampaign(req.body);
    res.status(201).json(campaign);
  })
);

advertisingRouter.get(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const { advertiserId } = req.query as { advertiserId?: string };
    res.json(await CampaignService.listCampaigns({ advertiserId }));
  })
);

advertisingRouter.get(
  "/campaigns/:id",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.getCampaign(req.params.id));
  })
);

advertisingRouter.patch(
  "/campaigns/:id",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.editCampaign(req.params.id, req.body));
  })
);

advertisingRouter.post(
  "/campaigns/:id/pause",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.pauseCampaign(req.params.id));
  })
);

advertisingRouter.post(
  "/campaigns/:id/activate",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.activateCampaign(req.params.id));
  })
);

advertisingRouter.post(
  "/campaigns/:id/archive",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.archiveCampaign(req.params.id));
  })
);

advertisingRouter.post(
  "/campaigns/:id/frequency-cap",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.setFrequencyCap(req.params.id, req.body));
  })
);

// Manual admin spend posting: records the advertiser-side debit and the
// platform-side revenue credit for one billing event in a single atomic
// transaction. See targeting.service.ts for why this isn't wired up
// automatically from impression recording.
advertisingRouter.post(
  "/campaigns/:id/spend",
  asyncHandler(async (req, res) => {
    const { amountCents, description } = req.body as { amountCents: number; description?: string };
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      badRequest("amountCents must be a positive integer");
    }
    const desc = description ?? `Manual ad spend posting for campaign ${req.params.id}`;
    const result = await prisma.$transaction(async (tx) => {
      const spend = await TargetingService.recordCampaignSpend(tx, req.params.id, amountCents, desc);
      const revenue = await TargetingService.recordAdRevenue(tx, req.params.id, amountCents, desc);
      return { spend, revenue };
    });
    res.status(201).json(result);
  })
);

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

advertisingRouter.post(
  "/campaigns/:id/creatives",
  asyncHandler(async (req, res) => {
    const creative = await CampaignService.addCreative(req.params.id, req.body);
    res.status(201).json(creative);
  })
);

advertisingRouter.post(
  "/campaigns/:id/creatives/replace",
  asyncHandler(async (req, res) => {
    const creative = await CampaignService.replaceCreative(req.params.id, req.body);
    res.status(201).json(creative);
  })
);

advertisingRouter.get(
  "/campaigns/:id/creatives",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.listCreatives(req.params.id));
  })
);

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

advertisingRouter.put(
  "/campaigns/:id/placements/:placement",
  asyncHandler(async (req, res) => {
    const placement = req.params.placement as AdPlacementSlot;
    const { priority } = req.body as { priority?: number };
    res.json(await CampaignService.setPlacement(req.params.id, { placement, priority }));
  })
);

advertisingRouter.delete(
  "/campaigns/:id/placements/:placement",
  asyncHandler(async (req, res) => {
    await CampaignService.removePlacement(req.params.id, req.params.placement as AdPlacementSlot);
    res.status(204).send();
  })
);

advertisingRouter.get(
  "/campaigns/:id/placements",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.listPlacements(req.params.id));
  })
);

// ---------------------------------------------------------------------------
// Target rules
// ---------------------------------------------------------------------------

advertisingRouter.post(
  "/campaigns/:id/target-rules",
  asyncHandler(async (req, res) => {
    const rule = await CampaignService.addTargetRule(req.params.id, req.body);
    res.status(201).json(rule);
  })
);

advertisingRouter.delete(
  "/campaigns/:id/target-rules/:ruleId",
  asyncHandler(async (req, res) => {
    await CampaignService.removeTargetRule(req.params.id, req.params.ruleId);
    res.status(204).send();
  })
);

advertisingRouter.get(
  "/campaigns/:id/target-rules",
  asyncHandler(async (req, res) => {
    res.json(await CampaignService.listTargetRules(req.params.id));
  })
);

// ---------------------------------------------------------------------------
// Ad serving
//
// NOTE: everything served from this router is an informational ad slot only
// (see AdPlacementSlot in schema.prisma). It never overlays, blocks, or
// replaces navigation, emergency controls, driver identification, or trip
// controls — those surfaces simply have no corresponding placement value.
// ---------------------------------------------------------------------------

advertisingRouter.get(
  "/serve",
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.placement || !q.viewerType || !q.viewerId) {
      badRequest("placement, viewerType and viewerId are required");
    }
    const viewerType = q.viewerType as AdViewerType;
    const viewerId = q.viewerId as string;

    // Computed server-side (never trust a client-supplied consent flag,
    // since that would let any caller simply claim consent). Maps the
    // generic viewer identity onto AD_CONSENT's driverId/riderId shape.
    const hasPersonalizedConsent = await hasPersonalizedAdConsent(
      viewerType === AdViewerType.DRIVER ? { driverId: viewerId } : { riderId: viewerId }
    );

    const campaigns = await TargetingService.resolveEligibleCampaigns({
      placement: q.placement as AdPlacementSlot,
      viewerType,
      viewerId,
      marketId: q.marketId ?? null,
      zoneId: q.zoneId ?? null,
      zip: q.zip ?? null,
      viewerLat: q.viewerLat ? Number(q.viewerLat) : null,
      viewerLng: q.viewerLng ? Number(q.viewerLng) : null,
      hasPersonalizedConsent,
    });
    res.json({ placement: q.placement, campaigns });
  })
);

advertisingRouter.post(
  "/impressions",
  asyncHandler(async (req, res) => {
    const impression = await TargetingService.recordImpression(req.body);
    res.status(201).json(impression);
  })
);

advertisingRouter.post(
  "/impressions/:id/click",
  asyncHandler(async (req, res) => {
    const click = await TargetingService.recordClick(req.params.id);
    res.status(201).json(click);
  })
);

advertisingRouter.post(
  "/conversions",
  asyncHandler(async (req, res) => {
    const conversion = await TargetingService.recordConversion(req.body);
    res.status(201).json(conversion);
  })
);

advertisingRouter.post(
  "/promo-redemptions",
  asyncHandler(async (req, res) => {
    const redemption = await TargetingService.redeemPromoCode(req.body);
    res.status(201).json(redemption);
  })
);

// ---------------------------------------------------------------------------
// Analytics (aggregated only — see analytics.service.ts)
// ---------------------------------------------------------------------------

advertisingRouter.get(
  "/campaigns/:id/analytics",
  asyncHandler(async (req, res) => {
    res.json(await AnalyticsService.getCampaignAnalytics(req.params.id));
  })
);

advertisingRouter.get(
  "/campaigns/:id/analytics/zones",
  asyncHandler(async (req, res) => {
    res.json(await AnalyticsService.getZonePerformance(req.params.id));
  })
);

advertisingRouter.get(
  "/campaigns/:id/analytics/zips",
  asyncHandler(async (req, res) => {
    res.json(await AnalyticsService.getZipPerformance(req.params.id));
  })
);
