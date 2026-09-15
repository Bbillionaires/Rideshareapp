import { SponsorshipContribution, SponsorshipProgram, SponsorshipProgramStatus } from "@prisma/client";
import { prisma, PrismaTx } from "../../lib/prisma";
import { postLedgerEntry } from "../../lib/ledger";
import { applyRate } from "../../lib/money";
import { badRequest, notFound } from "../../lib/http";

/**
 * SPONSORSHIPS module: businesses sponsoring driver incentives (e.g. an EV
 * bonus "Sponsored by Acme"). This module must stay independent of
 * EV_INCENTIVES — it knows nothing about EvCompensationRule/EvBonusLineItem;
 * EV_INCENTIVES calls into recordSponsorshipContribution, never the reverse.
 */

// ----------------------------------------------------------------------------
// Sponsor CRUD
// ----------------------------------------------------------------------------

export interface CreateSponsorInput {
  name: string;
  contactEmail?: string | null;
}

export async function createSponsor(input: CreateSponsorInput) {
  if (!input.name || !input.name.trim()) badRequest("Sponsor name is required");
  return prisma.sponsor.create({
    data: { name: input.name, contactEmail: input.contactEmail ?? null },
  });
}

export async function listSponsors() {
  return prisma.sponsor.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getSponsor(id: string) {
  const sponsor = await prisma.sponsor.findUnique({ where: { id } });
  if (!sponsor) notFound(`Sponsor ${id} not found`);
  return sponsor;
}

export async function updateSponsor(
  id: string,
  input: Partial<{ name: string; contactEmail: string | null; status: string }>
) {
  await getSponsor(id);
  return prisma.sponsor.update({ where: { id }, data: input });
}

// ----------------------------------------------------------------------------
// SponsorshipProgram CRUD
// ----------------------------------------------------------------------------

export interface CreateProgramInput {
  sponsorId: string;
  name: string;
  description?: string | null;
  contributionType: "FLAT_PER_TRIP" | "PERCENTAGE";
  contributionAmountCents?: number | null;
  contributionPercentage?: number | null;
  evOnly?: boolean;
  marketId?: string | null;
  serviceTypeId?: string | null;
  budgetTotalCents: number;
  startDate: Date | string;
  endDate?: Date | string | null;
  status?: SponsorshipProgramStatus;
}

function validateProgramInput(input: CreateProgramInput) {
  if (!input.sponsorId) badRequest("sponsorId is required");
  if (!input.name || !input.name.trim()) badRequest("Program name is required");
  if (input.contributionType === "FLAT_PER_TRIP" && !input.contributionAmountCents) {
    badRequest("contributionAmountCents is required when contributionType is FLAT_PER_TRIP");
  }
  if (input.contributionType === "PERCENTAGE" && input.contributionPercentage == null) {
    badRequest("contributionPercentage is required when contributionType is PERCENTAGE");
  }
  if (input.budgetTotalCents == null || input.budgetTotalCents < 0) {
    badRequest("budgetTotalCents must be a non-negative number");
  }
  if (!input.startDate) badRequest("startDate is required");
  if (input.endDate && new Date(input.endDate) < new Date(input.startDate)) {
    badRequest("endDate must not be before startDate");
  }
}

export async function createProgram(input: CreateProgramInput) {
  validateProgramInput(input);
  return prisma.sponsorshipProgram.create({
    data: {
      sponsorId: input.sponsorId,
      name: input.name,
      description: input.description ?? null,
      contributionType: input.contributionType,
      contributionAmountCents: input.contributionAmountCents ?? null,
      contributionPercentage: input.contributionPercentage ?? null,
      evOnly: input.evOnly ?? true,
      marketId: input.marketId ?? null,
      serviceTypeId: input.serviceTypeId ?? null,
      budgetTotalCents: input.budgetTotalCents,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      status: input.status ?? "DRAFT",
    },
  });
}

export async function listPrograms(filters?: { sponsorId?: string; status?: SponsorshipProgramStatus }) {
  return prisma.sponsorshipProgram.findMany({
    where: {
      ...(filters?.sponsorId ? { sponsorId: filters.sponsorId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProgram(id: string) {
  const program = await prisma.sponsorshipProgram.findUnique({
    where: { id },
    include: { contributions: { orderBy: { occurredAt: "desc" }, take: 50 } },
  });
  if (!program) notFound(`Sponsorship program ${id} not found`);
  return program;
}

export async function updateProgram(id: string, input: Partial<CreateProgramInput>) {
  const existing = await prisma.sponsorshipProgram.findUnique({ where: { id } });
  if (!existing) notFound(`Sponsorship program ${id} not found`);

  if (input.contributionType === "FLAT_PER_TRIP" && input.contributionAmountCents == null && existing!.contributionAmountCents == null) {
    badRequest("contributionAmountCents is required when contributionType is FLAT_PER_TRIP");
  }
  if (input.contributionType === "PERCENTAGE" && input.contributionPercentage == null && existing!.contributionPercentage == null) {
    badRequest("contributionPercentage is required when contributionType is PERCENTAGE");
  }
  if (input.endDate && input.startDate && new Date(input.endDate) < new Date(input.startDate)) {
    badRequest("endDate must not be before startDate");
  }

  return prisma.sponsorshipProgram.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.contributionType !== undefined ? { contributionType: input.contributionType } : {}),
      ...(input.contributionAmountCents !== undefined ? { contributionAmountCents: input.contributionAmountCents } : {}),
      ...(input.contributionPercentage !== undefined ? { contributionPercentage: input.contributionPercentage } : {}),
      ...(input.evOnly !== undefined ? { evOnly: input.evOnly } : {}),
      ...(input.marketId !== undefined ? { marketId: input.marketId } : {}),
      ...(input.serviceTypeId !== undefined ? { serviceTypeId: input.serviceTypeId } : {}),
      ...(input.budgetTotalCents !== undefined ? { budgetTotalCents: input.budgetTotalCents } : {}),
      ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate ? new Date(input.endDate) : null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}

export async function listContributionsForProgram(programId: string) {
  await getProgram(programId);
  return prisma.sponsorshipContribution.findMany({
    where: { programId },
    orderBy: { occurredAt: "desc" },
  });
}

// ----------------------------------------------------------------------------
// Contribution amount — the program's own contracted rate is authoritative.
// ----------------------------------------------------------------------------

/**
 * The amount a program has actually contracted to contribute for one
 * qualifying trip, per its own contributionType/contributionAmountCents/
 * contributionPercentage — this is what a sponsor is billed, regardless of
 * what any calling module's own bonus formula might otherwise suggest.
 * Callers (e.g. EV_INCENTIVES) must use this to derive the sponsor's share
 * rather than assuming their own computed bonus total is what the sponsor
 * owes; those two numbers are allowed to differ (see engine.ts, which
 * reconciles the difference onto the platform's share and logs a warning).
 */
export function computeProgramContributionCents(
  program: Pick<SponsorshipProgram, "contributionType" | "contributionAmountCents" | "contributionPercentage">,
  driverBaseEarningsCents: number
): number {
  if (program.contributionType === "FLAT_PER_TRIP") {
    return program.contributionAmountCents ?? 0;
  }
  return program.contributionPercentage
    ? applyRate(driverBaseEarningsCents, program.contributionPercentage.toNumber())
    : 0;
}

// ----------------------------------------------------------------------------
// Contribution recording — called by EV_INCENTIVES (and any future module)
// inside the caller's own transaction.
// ----------------------------------------------------------------------------

export interface RecordContributionInput {
  programId: string;
  rideId: string;
  driverId: string;
  /**
   * Must be derived from computeProgramContributionCents (the program's own
   * contracted rate) — never from another module's independently-computed
   * bonus total. This function trusts its caller for the amount but not for
   * which formula produced it; callers exist precisely so different bonus
   * mechanisms (EV rules today, others later) can all bill through the same
   * program contract.
   */
  amountCents: number;
}

/**
 * Records one SponsorshipContribution and its ledger entry, and bumps the
 * program's budgetSpentCents — all inside the caller's transaction (this
 * function never opens its own). Budget overage is logged as a warning, not
 * thrown, so a sponsor going over budget never breaks ride completion; it
 * shows up in analytics/reporting instead.
 */
export async function recordSponsorshipContribution(
  tx: PrismaTx,
  input: RecordContributionInput
): Promise<SponsorshipContribution> {
  const program = await tx.sponsorshipProgram.findUnique({ where: { id: input.programId } });
  if (!program) {
    throw new Error(`SPONSORSHIPS: sponsorship program ${input.programId} not found`);
  }

  const contribution = await tx.sponsorshipContribution.create({
    data: {
      programId: input.programId,
      rideId: input.rideId,
      driverId: input.driverId,
      amountCents: input.amountCents,
    },
  });

  const newSpentCents = program.budgetSpentCents + input.amountCents;
  if (newSpentCents > program.budgetTotalCents) {
    console.warn(
      `SPONSORSHIPS: program ${program.id} ("${program.name}") over budget: ` +
        `${newSpentCents} of ${program.budgetTotalCents} cents spent after contribution ${contribution.id}`
    );
  }
  await tx.sponsorshipProgram.update({
    where: { id: program.id },
    data: { budgetSpentCents: newSpentCents },
  });

  await postLedgerEntry(tx, {
    entryType: "SPONSORSHIP_CONTRIBUTION",
    sourceModule: "SPONSORSHIPS",
    direction: "DEBIT",
    partyType: "SPONSOR",
    partyId: program.sponsorId,
    rideId: input.rideId,
    sponsorshipContributionId: contribution.id,
    amountCents: input.amountCents,
    description: `Sponsorship contribution for ride ${input.rideId} under program "${program.name}"`,
  });

  return contribution;
}
