import { EvFundingSource } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { getEvBonusSummaryForRide } from "./engine";

/**
 * Admin CRUD for EvCompensationRule — the admin-configurable EV compensation
 * engine. Supports flat/percentage/per-mile components, minimum floors,
 * market/service-type scoping, promotional stacking, effective date ranges,
 * and platform/rider/sponsor/split funding attribution.
 */

export interface EvRuleInput {
  name: string;
  description?: string | null;
  marketId?: string | null;
  serviceTypeId?: string | null;
  flatAmountCents?: number | null;
  percentageRate?: number | null;
  perMileAmountCents?: number | null;
  minimumBonusAmountCents?: number | null;
  fundingSource?: EvFundingSource;
  splitConfig?: Record<string, number> | null;
  sponsorshipProgramId?: string | null;
  isPromotional?: boolean;
  priority?: number;
  effectiveStartDate: Date | string;
  effectiveEndDate?: Date | string | null;
  active?: boolean;
  createdBy?: string | null;
}

/** Validates reasonable field combinations; throws badRequest on any violation. */
function validateRuleInput(input: Partial<EvRuleInput>, existing?: {
  fundingSource: EvFundingSource;
  splitConfig: unknown;
  sponsorshipProgramId: string | null;
  flatAmountCents: number | null;
  percentageRate: unknown;
  perMileAmountCents: number | null;
}) {
  const fundingSource = input.fundingSource ?? existing?.fundingSource;
  const existingPercentageRate = existing && existing.percentageRate != null ? Number(existing.percentageRate) : null;

  const hasAnyComponent =
    (input.flatAmountCents ?? existing?.flatAmountCents ?? null) != null ||
    (input.percentageRate ?? existingPercentageRate) != null ||
    (input.perMileAmountCents ?? existing?.perMileAmountCents ?? null) != null;
  if (!hasAnyComponent) {
    badRequest("At least one of flatAmountCents, percentageRate, or perMileAmountCents must be set");
  }

  if (input.percentageRate != null && (input.percentageRate < 0 || input.percentageRate > 1)) {
    badRequest("percentageRate must be between 0 and 1 (e.g. 0.08 for 8%)");
  }

  if (fundingSource === "SPONSOR") {
    const sponsorshipProgramId = input.sponsorshipProgramId ?? existing?.sponsorshipProgramId ?? null;
    if (!sponsorshipProgramId) {
      badRequest("sponsorshipProgramId is required when fundingSource is SPONSOR");
    }
  }

  if (fundingSource === "SPLIT") {
    const splitConfig = (input.splitConfig ?? existing?.splitConfig ?? null) as Record<string, number> | null;
    if (!splitConfig || typeof splitConfig !== "object") {
      badRequest("splitConfig is required when fundingSource is SPLIT");
    } else {
      const shareSum = Object.values(splitConfig).reduce((a, b) => a + (Number(b) || 0), 0);
      if (Math.abs(shareSum - 1) > 0.001) {
        badRequest(`splitConfig shares must sum to 1 (got ${shareSum})`);
      }
      const sponsorshipProgramId = input.sponsorshipProgramId ?? existing?.sponsorshipProgramId ?? null;
      if ((splitConfig.sponsor ?? 0) > 0 && !sponsorshipProgramId) {
        badRequest("sponsorshipProgramId is required when splitConfig includes a sponsor share");
      }
    }
  }

  if (input.effectiveStartDate && input.effectiveEndDate) {
    if (new Date(input.effectiveEndDate) < new Date(input.effectiveStartDate)) {
      badRequest("effectiveEndDate must not be before effectiveStartDate");
    }
  }
}

export async function createRule(input: EvRuleInput) {
  if (!input.name || !input.name.trim()) badRequest("Rule name is required");
  if (!input.effectiveStartDate) badRequest("effectiveStartDate is required");
  validateRuleInput(input);

  return prisma.evCompensationRule.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      marketId: input.marketId ?? null,
      serviceTypeId: input.serviceTypeId ?? null,
      flatAmountCents: input.flatAmountCents ?? null,
      percentageRate: input.percentageRate ?? null,
      perMileAmountCents: input.perMileAmountCents ?? null,
      minimumBonusAmountCents: input.minimumBonusAmountCents ?? null,
      fundingSource: input.fundingSource ?? "PLATFORM",
      splitConfig: input.splitConfig ?? undefined,
      sponsorshipProgramId: input.sponsorshipProgramId ?? null,
      isPromotional: input.isPromotional ?? false,
      priority: input.priority ?? 0,
      effectiveStartDate: new Date(input.effectiveStartDate),
      effectiveEndDate: input.effectiveEndDate ? new Date(input.effectiveEndDate) : null,
      active: input.active ?? true,
      createdBy: input.createdBy ?? null,
    },
  });
}

export async function listRules(filters?: {
  marketId?: string;
  serviceTypeId?: string;
  active?: boolean;
  isPromotional?: boolean;
}) {
  return prisma.evCompensationRule.findMany({
    where: {
      ...(filters?.marketId !== undefined ? { marketId: filters.marketId } : {}),
      ...(filters?.serviceTypeId !== undefined ? { serviceTypeId: filters.serviceTypeId } : {}),
      ...(filters?.active !== undefined ? { active: filters.active } : {}),
      ...(filters?.isPromotional !== undefined ? { isPromotional: filters.isPromotional } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

export async function getRule(id: string) {
  const rule = await prisma.evCompensationRule.findUnique({ where: { id } });
  if (!rule) notFound(`EV compensation rule ${id} not found`);
  return rule;
}

export async function updateRule(id: string, input: Partial<EvRuleInput>) {
  const existing = await prisma.evCompensationRule.findUnique({ where: { id } });
  if (!existing) notFound(`EV compensation rule ${id} not found`);

  validateRuleInput(input, {
    fundingSource: existing!.fundingSource,
    splitConfig: existing!.splitConfig,
    sponsorshipProgramId: existing!.sponsorshipProgramId,
    flatAmountCents: existing!.flatAmountCents,
    percentageRate: existing!.percentageRate,
    perMileAmountCents: existing!.perMileAmountCents,
  });

  return prisma.evCompensationRule.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.marketId !== undefined ? { marketId: input.marketId } : {}),
      ...(input.serviceTypeId !== undefined ? { serviceTypeId: input.serviceTypeId } : {}),
      ...(input.flatAmountCents !== undefined ? { flatAmountCents: input.flatAmountCents } : {}),
      ...(input.percentageRate !== undefined ? { percentageRate: input.percentageRate } : {}),
      ...(input.perMileAmountCents !== undefined ? { perMileAmountCents: input.perMileAmountCents } : {}),
      ...(input.minimumBonusAmountCents !== undefined ? { minimumBonusAmountCents: input.minimumBonusAmountCents } : {}),
      ...(input.fundingSource !== undefined ? { fundingSource: input.fundingSource } : {}),
      ...(input.splitConfig !== undefined ? { splitConfig: input.splitConfig ?? undefined } : {}),
      ...(input.sponsorshipProgramId !== undefined ? { sponsorshipProgramId: input.sponsorshipProgramId } : {}),
      ...(input.isPromotional !== undefined ? { isPromotional: input.isPromotional } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.effectiveStartDate !== undefined ? { effectiveStartDate: new Date(input.effectiveStartDate) } : {}),
      ...(input.effectiveEndDate !== undefined
        ? { effectiveEndDate: input.effectiveEndDate ? new Date(input.effectiveEndDate) : null }
        : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function deactivateRule(id: string) {
  await getRule(id);
  return prisma.evCompensationRule.update({ where: { id }, data: { active: false } });
}

export async function getRideBonusBreakdown(rideId: string) {
  return getEvBonusSummaryForRide(rideId);
}
