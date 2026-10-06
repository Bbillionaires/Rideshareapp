import { TherapyConsentType, TherapyPayerType, TherapySessionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";
import { requestRide } from "../rides/service";
import { hasActiveTreatmentConsent, getCurrentTherapyConsent } from "./consent";
import { pickRouteOffers } from "./safe-routes";
import { applyInsuranceClaimPayout } from "./engine";

/**
 * THERAPY_RIDES: booking lifecycle for a licensed-therapist ride-along
 * session. A session's underlying trip is a normal Ride (see RIDES) created
 * only once a route is selected; the ride's length is meant to match
 * durationMinutes, not the route's distance. Fee posting on ride completion
 * lives in engine.ts (registered as a ride-completion hook, mirroring
 * EV_INCENTIVES / SPONSORSHIPS) so RIDES never needs to know this module
 * exists.
 */

// ----------------------------------------------------------------------------
// Therapist CRUD (minimal — admin-managed)
// ----------------------------------------------------------------------------

export interface CreateTherapistInput {
  name: string;
  email: string;
  licenseNumber: string;
  licenseState: string;
  npiNumber?: string | null;
}

export async function createTherapist(input: CreateTherapistInput) {
  if (!input.name || !input.name.trim()) badRequest("Therapist name is required");
  if (!input.licenseNumber || !input.licenseNumber.trim()) {
    badRequest("licenseNumber is required");
  }
  if (!input.licenseState || !input.licenseState.trim()) {
    badRequest("licenseState is required");
  }
  return prisma.therapist.create({
    data: {
      name: input.name,
      email: input.email,
      licenseNumber: input.licenseNumber,
      licenseState: input.licenseState,
      npiNumber: input.npiNumber ?? null,
    },
  });
}

export async function getTherapist(id: string) {
  const therapist = await prisma.therapist.findUnique({ where: { id } });
  if (!therapist) notFound(`Therapist ${id} not found`);
  return therapist;
}

// ----------------------------------------------------------------------------
// Session request + route offer/selection
// ----------------------------------------------------------------------------

export interface RequestSessionInput {
  patientId: string;
  therapistId: string;
  marketId: string;
  serviceTypeId: string;
  scheduledStart: Date | string;
  durationMinutes: number;
  feeCents: number;
  payerType: TherapyPayerType;
  sponsorId?: string | null;
  insurance?: {
    payerName: string;
    memberIdLast4: string;
    patientResponsibilityCents: number;
  } | null;
}

function validateRequestSessionInput(input: RequestSessionInput) {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    badRequest("durationMinutes must be a positive integer");
  }
  if (!Number.isInteger(input.feeCents) || input.feeCents <= 0) {
    badRequest("feeCents must be a positive integer");
  }
  if (input.payerType === TherapyPayerType.EMPLOYER_SPONSORED && !input.sponsorId) {
    badRequest("sponsorId is required when payerType is EMPLOYER_SPONSORED");
  }
  if (input.payerType === TherapyPayerType.INSURANCE) {
    if (!input.insurance) badRequest("insurance details are required when payerType is INSURANCE");
    if (
      input.insurance!.patientResponsibilityCents < 0 ||
      input.insurance!.patientResponsibilityCents > input.feeCents
    ) {
      badRequest("insurance.patientResponsibilityCents must be between 0 and feeCents");
    }
  }
}

/**
 * Requests a session and immediately offers routes. Fails closed on missing
 * consent: absence of a GRANTED TREATMENT_CONSENT record (or a withdrawn
 * one) blocks the request entirely — there is no "assume consent" path.
 *
 * The route offer is the therapist-safety mechanic described by the spec: up
 * to 3 of the assigned therapist's OWN pre-vetted TherapistSafeRoute rows,
 * chosen by closeness to durationMinutes. A therapist with zero active safe
 * routes configured cannot be booked — the patient is never offered a route
 * nobody vetted.
 */
export async function requestSession(input: RequestSessionInput) {
  validateRequestSessionInput(input);

  const consented = await hasActiveTreatmentConsent(input.patientId);
  if (!consented) {
    badRequest(
      `Patient ${input.patientId} does not have an active TREATMENT_CONSENT record; a session cannot be requested`
    );
  }
  const consentRecord = await getCurrentTherapyConsent(
    input.patientId,
    TherapyConsentType.TREATMENT_CONSENT
  );

  await getTherapist(input.therapistId);

  const routes = await pickRouteOffers(input.therapistId, input.durationMinutes);
  if (routes.length === 0) {
    badRequest(
      `Therapist ${input.therapistId} has no active safe routes configured; a session cannot be offered`
    );
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.therapySession.create({
      data: {
        patientId: input.patientId,
        therapistId: input.therapistId,
        marketId: input.marketId,
        serviceTypeId: input.serviceTypeId,
        status: TherapySessionStatus.ROUTE_OFFERED,
        scheduledStart: new Date(input.scheduledStart),
        durationMinutes: input.durationMinutes,
        feeCents: input.feeCents,
        payerType: input.payerType,
        sponsorId: input.payerType === TherapyPayerType.EMPLOYER_SPONSORED ? input.sponsorId : null,
        consentRecordId: consentRecord!.id,
      },
    });

    await tx.therapySessionRouteOffer.createMany({
      data: routes.map((route, index) => ({
        sessionId: created.id,
        safeRouteId: route.id,
        presentedOrder: index + 1,
      })),
    });

    if (input.payerType === TherapyPayerType.INSURANCE && input.insurance) {
      await tx.insuranceClaim.create({
        data: {
          sessionId: created.id,
          payerName: input.insurance.payerName,
          memberIdLast4: input.insurance.memberIdLast4,
          billedCents: input.feeCents - input.insurance.patientResponsibilityCents,
          patientResponsibilityCents: input.insurance.patientResponsibilityCents,
        },
      });
    }

    return created;
  });

  return getSession(session.id);
}

export async function getSession(id: string) {
  const session = await prisma.therapySession.findUnique({
    where: { id },
    include: {
      routeOffers: { include: { safeRoute: true }, orderBy: { presentedOrder: "asc" } },
      insuranceClaim: true,
    },
  });
  if (!session) notFound(`Therapy session ${id} not found`);
  return session;
}

/**
 * Patient selects one of the offered routes. This is the only point at
 * which the underlying Ride is created — before this, nothing has been
 * dispatched. marketId/serviceTypeId were supplied at request time; the
 * ride's zoneId comes from the selected route (if the route specifies one).
 */
export async function selectRoute(sessionId: string, routeOfferId: string) {
  const session = await prisma.therapySession.findUnique({ where: { id: sessionId } });
  if (!session) notFound(`Therapy session ${sessionId} not found`);
  if (session!.status !== TherapySessionStatus.ROUTE_OFFERED) {
    badRequest(`Therapy session ${sessionId} is not awaiting a route selection`);
  }

  const offer = await prisma.therapySessionRouteOffer.findUnique({
    where: { id: routeOfferId },
    include: { safeRoute: true },
  });
  if (!offer || offer.sessionId !== sessionId) {
    badRequest(`Route offer ${routeOfferId} does not belong to session ${sessionId}`);
  }

  // requestRide opens no transaction of its own (it's a single create), so
  // it's safe to call before the transaction below without risking a
  // partial-write inconsistency between the Ride and the session update.
  const ride = await requestRide({
    riderId: session!.patientId,
    marketId: session!.marketId,
    serviceTypeId: session!.serviceTypeId,
    zoneId: offer!.safeRoute.zoneId ?? undefined,
  });

  return prisma.$transaction(async (tx) => {
    await tx.therapySessionRouteOffer.update({
      where: { id: routeOfferId },
      data: { selectedAt: new Date() },
    });

    return tx.therapySession.update({
      where: { id: sessionId },
      data: { status: TherapySessionStatus.ROUTE_SELECTED, rideId: ride.id },
      include: { routeOffers: { include: { safeRoute: true } } },
    });
  });
}

export async function cancelSession(sessionId: string) {
  const session = await prisma.therapySession.findUnique({ where: { id: sessionId } });
  if (!session) notFound(`Therapy session ${sessionId} not found`);
  if (
    session!.status === TherapySessionStatus.COMPLETED ||
    session!.status === TherapySessionStatus.CANCELLED
  ) {
    badRequest(`Therapy session ${sessionId} cannot be cancelled from its current status`);
  }
  return prisma.therapySession.update({
    where: { id: sessionId },
    data: { status: TherapySessionStatus.CANCELLED, cancelledAt: new Date() },
  });
}

export async function markInsuranceClaimPaid(claimId: string) {
  return applyInsuranceClaimPayout(claimId);
}
