import { EvCompensationRule, Ride } from "@prisma/client";
import { prisma, PrismaTx } from "../../lib/prisma";
import { postDriverEarningsLine, postLedgerEntry, postRiderReceiptLine } from "../../lib/ledger";
import { applyRate, sumCents } from "../../lib/money";
import { isVehicleEvEligible } from "./eligibility";
import { computeProgramContributionCents, recordSponsorshipContribution } from "../sponsorships/service";

/**
 * EV_INCENTIVES rule engine.
 *
 * Admin-configurable EV compensation: flat bonus, percentage bonus, per-mile
 * supplement, optional minimum floor, market/service-type scoping,
 * promotional stacking, and funding-source attribution (platform / rider /
 * sponsor / split). Never hard-code a bonus amount here — every number comes
 * from an EvCompensationRule row.
 */

// ----------------------------------------------------------------------------
// Rule matching
// ----------------------------------------------------------------------------

async function findMatchingRules(ride: Ride, asOf: Date): Promise<EvCompensationRule[]> {
  return prisma.evCompensationRule.findMany({
    where: {
      active: true,
      effectiveStartDate: { lte: asOf },
      AND: [
        { OR: [{ marketId: null }, { marketId: ride.marketId }] },
        { OR: [{ serviceTypeId: null }, { serviceTypeId: ride.serviceTypeId }] },
        { OR: [{ effectiveEndDate: null }, { effectiveEndDate: { gte: asOf } }] },
      ],
    },
  });
}

/** 2 = both market and service type specifically match this ride; 1 = one does; 0 = a fully global rule. */
function specificity(rule: EvCompensationRule): number {
  const marketSpecific = rule.marketId !== null;
  const serviceSpecific = rule.serviceTypeId !== null;
  if (marketSpecific && serviceSpecific) return 2;
  if (marketSpecific || serviceSpecific) return 1;
  return 0;
}

/** Among non-promotional candidates, pick the single best-matching base rule. */
function pickBaseRule(candidates: EvCompensationRule[]): EvCompensationRule | undefined {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => {
    const specDiff = specificity(b) - specificity(a);
    if (specDiff !== 0) return specDiff;
    const priorityDiff = b.priority - a.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

// ----------------------------------------------------------------------------
// Per-rule amount computation
// ----------------------------------------------------------------------------

export interface RuleAmountBreakdown {
  flatComponentCents: number;
  percentageComponentCents: number;
  perMileComponentCents: number;
  minimumFloorAppliedCents: number | null;
  totalAmountCents: number;
}

function computeRuleAmount(
  rule: EvCompensationRule,
  driverBaseEarningsCents: number,
  distanceMiles: number
): RuleAmountBreakdown {
  const flatComponentCents = rule.flatAmountCents ?? 0;
  const percentageComponentCents = rule.percentageRate
    ? applyRate(driverBaseEarningsCents, rule.percentageRate.toNumber())
    : 0;
  const perMileComponentCents = rule.perMileAmountCents
    ? Math.round(rule.perMileAmountCents * distanceMiles)
    : 0;

  const rawTotalCents = sumCents(flatComponentCents, percentageComponentCents, perMileComponentCents);

  let minimumFloorAppliedCents: number | null = null;
  let totalAmountCents = rawTotalCents;
  if (rule.minimumBonusAmountCents != null && rawTotalCents < rule.minimumBonusAmountCents) {
    minimumFloorAppliedCents = rule.minimumBonusAmountCents;
    totalAmountCents = rule.minimumBonusAmountCents;
  }

  return { flatComponentCents, percentageComponentCents, perMileComponentCents, minimumFloorAppliedCents, totalAmountCents };
}

// ----------------------------------------------------------------------------
// Funding split
// ----------------------------------------------------------------------------

export interface FundingSplit {
  fundedByPlatformCents: number;
  fundedByRiderCents: number;
  fundedBySponsorCents: number;
}

/** Divides totalAmountCents proportionally across shares, putting any rounding remainder on the largest share. */
function splitProportionally(totalAmountCents: number, shares: Record<string, number>): Record<string, number> {
  const keys = Object.keys(shares).filter((k) => (shares[k] ?? 0) > 0);
  const result: Record<string, number> = {};
  let flooredSum = 0;
  for (const key of keys) {
    const raw = Math.floor(totalAmountCents * shares[key]);
    result[key] = raw;
    flooredSum += raw;
  }
  const remainder = totalAmountCents - flooredSum;
  if (remainder !== 0 && keys.length > 0) {
    const largestKey = keys.reduce((a, b) => (shares[a] >= shares[b] ? a : b));
    result[largestKey] = (result[largestKey] ?? 0) + remainder;
  }
  return result;
}

/**
 * Resolves how a rule's total bonus is funded. Returns null (and logs a
 * warning) when the rule is misconfigured in a way that would silently drop
 * money (SPONSOR/SPLIT-with-sponsor-share but no sponsorshipProgramId) —
 * callers must skip applying such a rule rather than throw, per spec.
 */
function computeFundingSplit(rule: EvCompensationRule, totalAmountCents: number): FundingSplit | null {
  switch (rule.fundingSource) {
    case "PLATFORM":
      return { fundedByPlatformCents: totalAmountCents, fundedByRiderCents: 0, fundedBySponsorCents: 0 };
    case "RIDER":
      return { fundedByPlatformCents: 0, fundedByRiderCents: totalAmountCents, fundedBySponsorCents: 0 };
    case "SPONSOR":
      if (!rule.sponsorshipProgramId) {
        console.warn(
          `EV_INCENTIVES: rule ${rule.id} (${rule.name}) has fundingSource=SPONSOR but no sponsorshipProgramId; skipping rule`
        );
        return null;
      }
      return { fundedByPlatformCents: 0, fundedByRiderCents: 0, fundedBySponsorCents: totalAmountCents };
    case "SPLIT": {
      const config = (rule.splitConfig ?? {}) as Record<string, number>;
      const shares: Record<string, number> = {
        platform: config.platform ?? 0,
        rider: config.rider ?? 0,
        sponsor: config.sponsor ?? 0,
      };
      if (shares.sponsor > 0 && !rule.sponsorshipProgramId) {
        console.warn(
          `EV_INCENTIVES: rule ${rule.id} (${rule.name}) has fundingSource=SPLIT with a sponsor share but no sponsorshipProgramId; skipping rule`
        );
        return null;
      }
      const parts = splitProportionally(totalAmountCents, shares);
      return {
        fundedByPlatformCents: parts.platform ?? 0,
        fundedByRiderCents: parts.rider ?? 0,
        fundedBySponsorCents: parts.sponsor ?? 0,
      };
    }
    default:
      console.warn(`EV_INCENTIVES: rule ${rule.id} has unrecognized fundingSource ${rule.fundingSource}; skipping rule`);
      return null;
  }
}

/**
 * The rule's own flat/percentage/per-mile config determines the SIZE of the
 * sponsor's naive share (via computeFundingSplit above), but the actual rate
 * a sponsor is contracted to pay lives on their SponsorshipProgram, not on
 * this rule — those two numbers can disagree (e.g. the rule computes a
 * $2.50 bonus but the program only contracted $2.00/trip). This reconciles
 * them: the program's contracted rate always wins for what's billed to the
 * sponsor, the rider's share (if any, from an admin's SPLIT config) is left
 * untouched, and the platform absorbs whatever difference is left over so
 * the three shares always sum back to the rule's totalAmountCents exactly —
 * a shortfall or an over-generous nominal rate never goes unaccounted for.
 */
function reconcileSponsorFunding(
  funding: FundingSplit,
  totalAmountCents: number,
  contractedSponsorCents: number,
  ruleId: string
): FundingSplit {
  if (contractedSponsorCents === funding.fundedBySponsorCents) return funding;

  const maxSponsorCents = Math.max(0, totalAmountCents - funding.fundedByRiderCents);
  const clampedSponsorCents = Math.min(Math.max(0, contractedSponsorCents), maxSponsorCents);
  const newPlatformCents = totalAmountCents - funding.fundedByRiderCents - clampedSponsorCents;

  console.warn(
    `EV_INCENTIVES: rule ${ruleId} attributed ${funding.fundedBySponsorCents} cents to the sponsor, ` +
      `but the linked SponsorshipProgram's contracted rate computes to ${contractedSponsorCents} cents; ` +
      `billing the sponsor ${clampedSponsorCents} cents (the program's rate) and adjusting the ` +
      `platform's share to ${newPlatformCents} cents so the total still equals the driver's ${totalAmountCents}-cent bonus.`
  );

  return {
    fundedBySponsorCents: clampedSponsorCents,
    fundedByRiderCents: funding.fundedByRiderCents,
    fundedByPlatformCents: newPlatformCents,
  };
}

// ----------------------------------------------------------------------------
// Ride-finalizer hook
// ----------------------------------------------------------------------------

/**
 * Ride-completion hook registered via register.ts. Applies the applicable EV
 * compensation rule(s) to a just-completed ride: one base (non-promotional)
 * rule plus any number of stacked promotional rules. Skips entirely when the
 * ride's vehicle is not EV-eligible, or when nothing matches.
 *
 * Promotions "layer on top of standard EV compensation" (per spec), so they
 * are only applied when a base rule was also found — a stray promotional
 * rule with no configured base EV program for this market/service type is
 * treated as "no EV program here" rather than as its own freestanding bonus.
 */
export async function applyEvBonusToRide(ride: Ride): Promise<void> {
  if (!ride.vehicleId) return;
  const eligible = await isVehicleEvEligible(ride.vehicleId);
  if (!eligible) return;
  if (!ride.driverId) return; // nobody to pay

  const fare = await prisma.rideFare.findUnique({ where: { rideId: ride.id } });
  if (!fare) {
    console.warn(`EV_INCENTIVES: no RideFare found for ride ${ride.id} yet; skipping EV bonus`);
    return;
  }

  const asOf = ride.completedAt ?? new Date();
  const distanceMiles = ride.distanceMiles ? Number(ride.distanceMiles) : 0;

  const matches = await findMatchingRules(ride, asOf);
  const baseCandidates = matches.filter((r) => !r.isPromotional);
  const promoRules = matches.filter((r) => r.isPromotional);

  const baseRule = pickBaseRule(baseCandidates);
  if (!baseRule) return; // no base EV program configured for this market/service type — nothing to apply

  const rulesToApply: EvCompensationRule[] = [baseRule, ...promoRules];

  await prisma.$transaction(async (tx) => {
    for (const rule of rulesToApply) {
      await applyOneRule(tx, ride, rule, fare.driverBaseEarningsCents, distanceMiles);
    }
  });
}

async function applyOneRule(
  tx: PrismaTx,
  ride: Ride,
  rule: EvCompensationRule,
  driverBaseEarningsCents: number,
  distanceMiles: number
): Promise<void> {
  const amounts = computeRuleAmount(rule, driverBaseEarningsCents, distanceMiles);
  if (amounts.totalAmountCents <= 0) return; // nothing to pay out for this rule

  let funding = computeFundingSplit(rule, amounts.totalAmountCents);
  if (!funding) return; // misconfigured rule; warning already logged, skip without throwing

  // Reconcile the rule's naive sponsor guess against the program's own
  // contracted rate before creating any row, so everything we persist below
  // (EvBonusLineItem, ledger entries, the contribution itself) reflects the
  // authoritative, reconciled split.
  let sponsorshipProgram = null;
  if (funding.fundedBySponsorCents > 0) {
    sponsorshipProgram = await tx.sponsorshipProgram.findUnique({
      where: { id: rule.sponsorshipProgramId as string },
    });
    if (!sponsorshipProgram) {
      console.warn(
        `EV_INCENTIVES: rule ${rule.id} references sponsorship program ${rule.sponsorshipProgramId}, which no longer exists; skipping rule`
      );
      return;
    }
    const contractedSponsorCents = computeProgramContributionCents(sponsorshipProgram, driverBaseEarningsCents);
    funding = reconcileSponsorFunding(funding, amounts.totalAmountCents, contractedSponsorCents, rule.id);
  }

  const lineItem = await tx.evBonusLineItem.create({
    data: {
      rideId: ride.id,
      ruleId: rule.id,
      ruleNameSnapshot: rule.name,
      isPromotional: rule.isPromotional,
      flatComponentCents: amounts.flatComponentCents,
      percentageComponentCents: amounts.percentageComponentCents,
      perMileComponentCents: amounts.perMileComponentCents,
      minimumFloorAppliedCents: amounts.minimumFloorAppliedCents,
      totalAmountCents: amounts.totalAmountCents,
      fundingSource: rule.fundingSource,
      fundedByPlatformCents: funding.fundedByPlatformCents,
      fundedByRiderCents: funding.fundedByRiderCents,
      fundedBySponsorCents: funding.fundedBySponsorCents,
    },
  });

  if (funding.fundedBySponsorCents > 0) {
    // sponsorshipProgramId presence already validated in computeFundingSplit
    const contribution = await recordSponsorshipContribution(tx, {
      programId: rule.sponsorshipProgramId as string,
      rideId: ride.id,
      driverId: ride.driverId as string,
      amountCents: funding.fundedBySponsorCents,
    });
    await tx.evBonusLineItem.update({
      where: { id: lineItem.id },
      data: { sponsorshipContributionId: contribution.id },
    });
  }

  const driverCreditEntry = await postLedgerEntry(tx, {
    entryType: "RIDE_EV_SUPPLEMENT",
    sourceModule: "EV_INCENTIVES",
    direction: "CREDIT",
    partyType: "DRIVER",
    partyId: ride.driverId as string,
    driverId: ride.driverId as string,
    rideId: ride.id,
    evBonusLineItemId: lineItem.id,
    amountCents: amounts.totalAmountCents,
    description: `EV supplement (${rule.name}) for ride ${ride.id}`,
  });

  if (funding.fundedByPlatformCents > 0) {
    await postLedgerEntry(tx, {
      entryType: "RIDE_EV_SUPPLEMENT",
      sourceModule: "EV_INCENTIVES",
      direction: "DEBIT",
      partyType: "PLATFORM",
      rideId: ride.id,
      evBonusLineItemId: lineItem.id,
      amountCents: funding.fundedByPlatformCents,
      description: `Platform-funded portion of EV supplement (${rule.name}) for ride ${ride.id}`,
    });
  }

  let riderDebitEntryId: string | null = null;
  if (funding.fundedByRiderCents > 0) {
    const riderDebitEntry = await postLedgerEntry(tx, {
      entryType: "RIDE_EV_SUPPLEMENT",
      sourceModule: "EV_INCENTIVES",
      direction: "DEBIT",
      partyType: "RIDER",
      partyId: ride.riderId,
      rideId: ride.id,
      evBonusLineItemId: lineItem.id,
      amountCents: funding.fundedByRiderCents,
      description: `Rider-funded portion of EV supplement (${rule.name}) for ride ${ride.id}`,
    });
    riderDebitEntryId = riderDebitEntry.id;
  }
  // The sponsor-funded portion (if any) was already posted as a
  // SPONSORSHIP_CONTRIBUTION / DEBIT / SPONSOR entry inside
  // recordSponsorshipContribution above — EV_INCENTIVES does not post that leg.

  await postDriverEarningsLine(tx, {
    driverId: ride.driverId as string,
    rideId: ride.id,
    lineType: "EV_SUPPLEMENT",
    amountCents: amounts.totalAmountCents,
    description: `EV supplement (${rule.name})`,
    ledgerEntryId: driverCreditEntry.id,
    evBonusLineItemId: lineItem.id,
  });

  if (funding.fundedByRiderCents > 0 && riderDebitEntryId) {
    await postRiderReceiptLine(tx, {
      rideId: ride.id,
      lineType: "EV_SUPPLEMENT_CHARGE",
      amountCents: funding.fundedByRiderCents,
      description: `EV supplement charge (${rule.name})`,
      ledgerEntryId: riderDebitEntryId,
      evBonusLineItemId: lineItem.id,
    });
  }
}

// ----------------------------------------------------------------------------
// Receipt / ledger display helper
// ----------------------------------------------------------------------------

export interface EvBonusSummaryLine {
  id: string;
  ruleId: string;
  ruleName: string;
  isPromotional: boolean;
  flatComponentCents: number;
  percentageComponentCents: number;
  perMileComponentCents: number;
  minimumFloorAppliedCents: number | null;
  totalAmountCents: number;
  fundingSource: string;
  fundedByPlatformCents: number;
  fundedByRiderCents: number;
  fundedBySponsorCents: number;
  sponsorshipContributionId: string | null;
}

export interface EvBonusSummary {
  rideId: string;
  totalEvBonusCents: number;
  lineItems: EvBonusSummaryLine[];
}

/**
 * The EV component of a ride's earnings/receipt, regardless of who funded
 * it — this is what "clearly identifies the EV component" for display on
 * both the rider receipt and the driver earnings ledger.
 */
export async function getEvBonusSummaryForRide(rideId: string): Promise<EvBonusSummary> {
  const lineItems = await prisma.evBonusLineItem.findMany({
    where: { rideId },
    orderBy: { createdAt: "asc" },
  });

  return {
    rideId,
    totalEvBonusCents: sumCents(...lineItems.map((li) => li.totalAmountCents)),
    lineItems: lineItems.map((li) => ({
      id: li.id,
      ruleId: li.ruleId,
      ruleName: li.ruleNameSnapshot,
      isPromotional: li.isPromotional,
      flatComponentCents: li.flatComponentCents,
      percentageComponentCents: li.percentageComponentCents,
      perMileComponentCents: li.perMileComponentCents,
      minimumFloorAppliedCents: li.minimumFloorAppliedCents,
      totalAmountCents: li.totalAmountCents,
      fundingSource: li.fundingSource,
      fundedByPlatformCents: li.fundedByPlatformCents,
      fundedByRiderCents: li.fundedByRiderCents,
      fundedBySponsorCents: li.fundedBySponsorCents,
      sponsorshipContributionId: li.sponsorshipContributionId,
    })),
  };
}
