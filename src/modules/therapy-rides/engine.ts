import { InsuranceClaimStatus, Ride, TherapySessionStatus } from "@prisma/client";
import { prisma, PrismaTx } from "../../lib/prisma";
import { postLedgerEntry } from "../../lib/ledger";
import { applyRate } from "../../lib/money";

const THERAPY_PLATFORM_FEE_RATE = 0.2; // platform's cut of the session fee, same rate as PRICING's ride fee

/**
 * THERAPY_RIDES fee engine.
 *
 * Money only moves when it has actually moved: SELF_PAY and
 * EMPLOYER_SPONSORED post the full feeCents immediately at ride completion
 * (mirroring how SPONSORSHIPS treats a sponsor's contracted contribution as
 * billed on the spot). INSURANCE only ever charges the patient's own
 * responsibility portion immediately; the insurer's share is NOT posted to
 * the ledger until markInsuranceClaimPaid() is called, because this MVP has
 * no clearinghouse/remittance integration and the ledger must never record
 * cash that hasn't actually been collected (see README known gaps).
 */

// ----------------------------------------------------------------------------
// Ride-completion hook
// ----------------------------------------------------------------------------

export async function applyTherapyFeeToRide(ride: Ride): Promise<void> {
  const session = await prisma.therapySession.findUnique({ where: { rideId: ride.id } });
  if (!session) return; // not a therapy ride
  if (
    session.status === TherapySessionStatus.COMPLETED ||
    session.status === TherapySessionStatus.CANCELLED
  ) {
    return; // idempotent — already settled
  }

  await prisma.$transaction(async (tx) => {
    if (session.payerType === "SELF_PAY") {
      await postPatientCharge(tx, session.id, session.patientId, ride.id, session.feeCents);
      await postTherapistPayout(tx, session.id, session.therapistId, ride.id, session.feeCents);
    } else if (session.payerType === "EMPLOYER_SPONSORED") {
      await postEmployerContribution(tx, session.id, session.sponsorId as string, ride.id, session.feeCents);
      await postTherapistPayout(tx, session.id, session.therapistId, ride.id, session.feeCents);
    } else {
      // INSURANCE: charge only the patient's own responsibility now; the
      // insurer-funded remainder (already recorded on the InsuranceClaim at
      // request time) is posted later via markInsuranceClaimPaid.
      const claim = await tx.insuranceClaim.findUnique({ where: { sessionId: session.id } });
      if (claim && claim.patientResponsibilityCents > 0) {
        await postPatientCharge(
          tx,
          session.id,
          session.patientId,
          ride.id,
          claim.patientResponsibilityCents
        );
      }
    }

    await tx.therapySession.update({
      where: { id: session.id },
      data: { status: TherapySessionStatus.COMPLETED, completedAt: new Date() },
    });
  });
}

async function postPatientCharge(
  tx: PrismaTx,
  sessionId: string,
  patientId: string,
  rideId: string,
  amountCents: number
) {
  await postLedgerEntry(tx, {
    entryType: "THERAPY_SESSION_PATIENT_CHARGE",
    sourceModule: "THERAPY_RIDES",
    direction: "DEBIT",
    partyType: "RIDER",
    partyId: patientId,
    rideId,
    therapySessionId: sessionId,
    amountCents,
    description: `Therapy session fee (patient portion) for session ${sessionId}`,
  });
}

async function postEmployerContribution(
  tx: PrismaTx,
  sessionId: string,
  sponsorId: string,
  rideId: string,
  amountCents: number
) {
  await postLedgerEntry(tx, {
    entryType: "THERAPY_SESSION_EMPLOYER_CONTRIBUTION",
    sourceModule: "THERAPY_RIDES",
    direction: "DEBIT",
    partyType: "SPONSOR",
    partyId: sponsorId,
    rideId,
    therapySessionId: sessionId,
    amountCents,
    description: `Employer-sponsored therapy session contribution for session ${sessionId}`,
  });
}

/** Splits a funded amount into the therapist's earnings and the platform's fee, and posts both. */
async function postTherapistPayout(
  tx: PrismaTx,
  sessionId: string,
  therapistId: string,
  rideId: string,
  fundedAmountCents: number,
  insuranceClaimId?: string
) {
  const platformFeeCents = applyRate(fundedAmountCents, THERAPY_PLATFORM_FEE_RATE);
  const therapistEarningsCents = fundedAmountCents - platformFeeCents;

  if (therapistEarningsCents > 0) {
    await postLedgerEntry(tx, {
      entryType: "THERAPY_SESSION_THERAPIST_EARNINGS",
      sourceModule: "THERAPY_RIDES",
      direction: "CREDIT",
      partyType: "THERAPIST",
      partyId: therapistId,
      rideId,
      therapySessionId: sessionId,
      insuranceClaimId: insuranceClaimId ?? null,
      amountCents: therapistEarningsCents,
      description: `Therapist earnings for session ${sessionId}`,
    });
  }
  if (platformFeeCents > 0) {
    await postLedgerEntry(tx, {
      entryType: "THERAPY_SESSION_PLATFORM_FEE",
      sourceModule: "THERAPY_RIDES",
      direction: "CREDIT",
      partyType: "PLATFORM",
      rideId,
      therapySessionId: sessionId,
      insuranceClaimId: insuranceClaimId ?? null,
      amountCents: platformFeeCents,
      description: `Platform fee for therapy session ${sessionId}`,
    });
  }
}

// ----------------------------------------------------------------------------
// Insurance claim settlement (manual — no clearinghouse integration in MVP)
// ----------------------------------------------------------------------------

/**
 * Records that an insurer has actually paid a claim, and ONLY NOW posts the
 * therapist-earnings/platform-fee ledger entries for the insurer-funded
 * portion — nothing here happens automatically; this must be called by a
 * back-office/billing workflow once real remittance is received.
 */
export async function applyInsuranceClaimPayout(claimId: string) {
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    include: { session: true },
  });
  if (!claim) throw new Error(`InsuranceClaim ${claimId} not found`);
  if (claim.status !== InsuranceClaimStatus.SUBMITTED) {
    throw new Error(`InsuranceClaim ${claimId} is not in SUBMITTED status`);
  }
  if (!claim.session.rideId) {
    throw new Error(`Therapy session ${claim.sessionId} has no associated ride yet`);
  }

  await prisma.$transaction(async (tx) => {
    await postTherapistPayout(
      tx,
      claim.sessionId,
      claim.session.therapistId,
      claim.session.rideId as string,
      claim.billedCents,
      claim.id
    );
    await tx.insuranceClaim.update({
      where: { id: claimId },
      data: { status: InsuranceClaimStatus.PAID, paidAt: new Date() },
    });
  });
}
