import { createAdvertiser, createCampaign, activateCampaign, setPlacement, addTargetRule } from "../../src/modules/advertising/campaign.service";
import { resolveEligibleCampaigns } from "../../src/modules/advertising/targeting.service";
import { hasPersonalizedAdConsent, recordConsent } from "../../src/modules/ad-consent/service";
import { prisma } from "../../src/lib/prisma";
import { createTestRider, disconnectDatabase, resetDatabase, seedBaseline } from "../helpers/db";

async function createActiveZoneCampaign(marketId: string, zoneId: string) {
  const advertiser = await createAdvertiser({ name: "Local Restaurant" });
  const campaign = await createCampaign({
    advertiserId: advertiser.id,
    name: "Jacksonville Lunch Promotion",
    budgetTotalCents: 100_000,
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(Date.now() + 30 * 86_400_000),
  });
  await activateCampaign(campaign.id);
  await setPlacement(campaign.id, { placement: "POST_TRIP_SCREEN" });
  await addTargetRule(campaign.id, { scope: "ZONE", marketId, zoneId });
  return campaign;
}

describe("ADVERTISING geographic targeting + AD_CONSENT gating", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("never resolves a zone-scoped campaign for a rider who has not granted personalized consent", async () => {
    const { market } = await seedBaseline();
    const rider = await createTestRider();
    const zone = await prisma.zone.create({ data: { marketId: market.id, name: "Southside", color: "GREEN" } });
    await createActiveZoneCampaign(market.id, zone.id);

    const consented = await hasPersonalizedAdConsent({ riderId: rider.id });
    expect(consented).toBe(false); // absence of a record = not consented, fail closed

    const campaigns = await resolveEligibleCampaigns({
      placement: "POST_TRIP_SCREEN",
      viewerType: "RIDER",
      viewerId: rider.id,
      marketId: market.id,
      zoneId: zone.id,
      hasPersonalizedConsent: consented,
    });
    expect(campaigns).toHaveLength(0);
  });

  it("resolves a zone-scoped campaign once personalized consent is granted, and stops the moment it's withdrawn", async () => {
    const { market } = await seedBaseline();
    const rider = await createTestRider();
    const zone = await prisma.zone.create({ data: { marketId: market.id, name: "Southside", color: "GREEN" } });
    const campaign = await createActiveZoneCampaign(market.id, zone.id);

    await recordConsent({ riderId: rider.id, consentType: "PERSONALIZED_OFFERS", status: "GRANTED", policyVersion: "v1" });
    let consented = await hasPersonalizedAdConsent({ riderId: rider.id });
    expect(consented).toBe(true);

    let campaigns = await resolveEligibleCampaigns({
      placement: "POST_TRIP_SCREEN",
      viewerType: "RIDER",
      viewerId: rider.id,
      marketId: market.id,
      zoneId: zone.id,
      hasPersonalizedConsent: consented,
    });
    expect(campaigns.map((c) => c.id)).toEqual([campaign.id]);

    await recordConsent({ riderId: rider.id, consentType: "PERSONALIZED_OFFERS", status: "WITHDRAWN", policyVersion: "v1" });
    consented = await hasPersonalizedAdConsent({ riderId: rider.id });
    expect(consented).toBe(false);

    campaigns = await resolveEligibleCampaigns({
      placement: "POST_TRIP_SCREEN",
      viewerType: "RIDER",
      viewerId: rider.id,
      marketId: market.id,
      zoneId: zone.id,
      hasPersonalizedConsent: consented,
    });
    expect(campaigns).toHaveLength(0);
  });

  it("resolves an ENTIRE_MARKET campaign for every viewer regardless of personalized consent", async () => {
    const { market } = await seedBaseline();
    const advertiser = await createAdvertiser({ name: "Citywide Sponsor" });
    const campaign = await createCampaign({
      advertiserId: advertiser.id,
      name: "Jacksonville Market-Wide Promo",
      budgetTotalCents: 100_000,
      startDate: new Date(Date.now() - 86_400_000),
    });
    await activateCampaign(campaign.id);
    await setPlacement(campaign.id, { placement: "RECEIPT_SCREEN" });
    await addTargetRule(campaign.id, { scope: "ENTIRE_MARKET", marketId: market.id });

    const campaigns = await resolveEligibleCampaigns({
      placement: "RECEIPT_SCREEN",
      viewerType: "RIDER",
      viewerId: "rider-no-consent",
      marketId: market.id,
      hasPersonalizedConsent: false,
    });
    expect(campaigns.map((c) => c.id)).toEqual([campaign.id]);
  });
});
