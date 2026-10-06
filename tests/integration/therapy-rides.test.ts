import { TherapyConsentStatus, TherapyConsentType, TherapyPayerType } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { recordTherapyConsent } from "../../src/modules/therapy-rides/consent";
import * as TherapyRidesService from "../../src/modules/therapy-rides/service";
import { markInsuranceClaimPaid } from "../../src/modules/therapy-rides/service";
import { completeRide } from "../../src/modules/rides/service";
import { applyTherapyFeeToRide } from "../../src/modules/therapy-rides/engine";
import {
  createTestRider,
  createTestTherapist,
  createTherapistSafeRoute,
  disconnectDatabase,
  resetDatabase,
  seedBaseline,
} from "../helpers/db";

async function grantConsent(patientId: string) {
  return recordTherapyConsent({
    patientId,
    consentType: TherapyConsentType.TREATMENT_CONSENT,
    status: TherapyConsentStatus.GRANTED,
    policyVersion: "v1",
  });
}

describe("THERAPY_RIDES", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("refuses to request a session without an active TREATMENT_CONSENT record", async () => {
    const { market, standard } = await seedBaseline();
    const patient = await createTestRider();
    const therapist = await createTestTherapist();
    await createTherapistSafeRoute(therapist.id, { estimatedDurationMinutes: 50 });

    await expect(
      TherapyRidesService.requestSession({
        patientId: patient.id,
        therapistId: therapist.id,
        marketId: market.id,
        serviceTypeId: standard.id,
        scheduledStart: new Date(),
        durationMinutes: 50,
        feeCents: 15000,
        payerType: TherapyPayerType.SELF_PAY,
      })
    ).rejects.toThrow();
  });

  it("only ever offers routes drawn from the assigned therapist's own vetted safe-route list", async () => {
    const { market, standard } = await seedBaseline();
    const patient = await createTestRider();
    const therapist = await createTestTherapist();
    const otherTherapist = await createTestTherapist();
    const r1 = await createTherapistSafeRoute(therapist.id, { name: "A", estimatedDurationMinutes: 45 });
    const r2 = await createTherapistSafeRoute(therapist.id, { name: "B", estimatedDurationMinutes: 50 });
    const r3 = await createTherapistSafeRoute(therapist.id, { name: "C", estimatedDurationMinutes: 60 });
    await createTherapistSafeRoute(otherTherapist.id, { name: "Not this therapist's", estimatedDurationMinutes: 50 });
    await grantConsent(patient.id);

    const session = await TherapyRidesService.requestSession({
      patientId: patient.id,
      therapistId: therapist.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      scheduledStart: new Date(),
      durationMinutes: 50,
      feeCents: 15000,
      payerType: TherapyPayerType.SELF_PAY,
    });

    const offeredRouteIds = session.routeOffers.map((o) => o.safeRouteId).sort();
    expect(offeredRouteIds).toEqual([r1.id, r2.id, r3.id].sort());
  });

  it("SELF_PAY: charges the patient the full fee and splits it between therapist earnings and platform fee", async () => {
    const { market, standard } = await seedBaseline();
    const patient = await createTestRider();
    const therapist = await createTestTherapist();
    await createTherapistSafeRoute(therapist.id, { estimatedDurationMinutes: 50 });
    await grantConsent(patient.id);

    const session = await TherapyRidesService.requestSession({
      patientId: patient.id,
      therapistId: therapist.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      scheduledStart: new Date(),
      durationMinutes: 50,
      feeCents: 15000,
      payerType: TherapyPayerType.SELF_PAY,
    });

    const selected = await TherapyRidesService.selectRoute(session.id, session.routeOffers[0].id);
    expect(selected.rideId).toBeTruthy();

    const completedRide = await completeRide(selected.rideId as string, {
      distanceMiles: 3,
      durationMinutes: 50,
    });
    // Mirrors what bootstrap.ts's hook registry does in production — the
    // test process never imports bootstrap.ts, so the hook must be invoked
    // directly here (same pattern used by the EV_INCENTIVES tests).
    await applyTherapyFeeToRide(completedRide);

    const entries = await prisma.ledgerEntry.findMany({ where: { therapySessionId: session.id } });
    const byType = Object.fromEntries(entries.map((e) => [e.entryType, e.amountCents]));

    expect(byType.THERAPY_SESSION_PATIENT_CHARGE).toBe(15000);
    expect(byType.THERAPY_SESSION_THERAPIST_EARNINGS + byType.THERAPY_SESSION_PLATFORM_FEE).toBe(15000);
    expect(byType.THERAPY_SESSION_EMPLOYER_CONTRIBUTION).toBeUndefined();

    const completed = await TherapyRidesService.getSession(session.id);
    expect(completed.status).toBe("COMPLETED");
  });

  it("EMPLOYER_SPONSORED: bills the full fee to the sponsor and posts no patient charge", async () => {
    const { market, standard } = await seedBaseline();
    const patient = await createTestRider();
    const therapist = await createTestTherapist();
    await createTherapistSafeRoute(therapist.id, { estimatedDurationMinutes: 50 });
    await grantConsent(patient.id);
    const sponsor = await prisma.sponsor.create({ data: { name: "Acme EAP" } });

    const session = await TherapyRidesService.requestSession({
      patientId: patient.id,
      therapistId: therapist.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      scheduledStart: new Date(),
      durationMinutes: 50,
      feeCents: 15000,
      payerType: TherapyPayerType.EMPLOYER_SPONSORED,
      sponsorId: sponsor.id,
    });

    const selected = await TherapyRidesService.selectRoute(session.id, session.routeOffers[0].id);
    const completedRide = await completeRide(selected.rideId as string, {
      distanceMiles: 3,
      durationMinutes: 50,
    });
    // Mirrors what bootstrap.ts's hook registry does in production — the
    // test process never imports bootstrap.ts, so the hook must be invoked
    // directly here (same pattern used by the EV_INCENTIVES tests).
    await applyTherapyFeeToRide(completedRide);

    const entries = await prisma.ledgerEntry.findMany({ where: { therapySessionId: session.id } });
    const byType = Object.fromEntries(entries.map((e) => [e.entryType, e.amountCents]));

    expect(byType.THERAPY_SESSION_EMPLOYER_CONTRIBUTION).toBe(15000);
    expect(byType.THERAPY_SESSION_PATIENT_CHARGE).toBeUndefined();
    expect(byType.THERAPY_SESSION_THERAPIST_EARNINGS + byType.THERAPY_SESSION_PLATFORM_FEE).toBe(15000);
  });

  it("INSURANCE: charges only the patient's responsibility up front, and defers the insurer's share until the claim is marked paid", async () => {
    const { market, standard } = await seedBaseline();
    const patient = await createTestRider();
    const therapist = await createTestTherapist();
    await createTherapistSafeRoute(therapist.id, { estimatedDurationMinutes: 50 });
    await grantConsent(patient.id);

    const session = await TherapyRidesService.requestSession({
      patientId: patient.id,
      therapistId: therapist.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      scheduledStart: new Date(),
      durationMinutes: 50,
      feeCents: 15000,
      payerType: TherapyPayerType.INSURANCE,
      insurance: { payerName: "Acme Health", memberIdLast4: "1234", patientResponsibilityCents: 2000 },
    });

    const selected = await TherapyRidesService.selectRoute(session.id, session.routeOffers[0].id);
    const completedRide = await completeRide(selected.rideId as string, {
      distanceMiles: 3,
      durationMinutes: 50,
    });
    // Mirrors what bootstrap.ts's hook registry does in production — the
    // test process never imports bootstrap.ts, so the hook must be invoked
    // directly here (same pattern used by the EV_INCENTIVES tests).
    await applyTherapyFeeToRide(completedRide);

    let entries = await prisma.ledgerEntry.findMany({ where: { therapySessionId: session.id } });
    let byType = Object.fromEntries(entries.map((e) => [e.entryType, e.amountCents]));
    expect(byType.THERAPY_SESSION_PATIENT_CHARGE).toBe(2000);
    expect(byType.THERAPY_SESSION_THERAPIST_EARNINGS).toBeUndefined();
    expect(byType.THERAPY_SESSION_PLATFORM_FEE).toBeUndefined();

    const claim = await prisma.insuranceClaim.findUnique({ where: { sessionId: session.id } });
    expect(claim?.status).toBe("SUBMITTED");
    expect(claim?.billedCents).toBe(13000);

    await markInsuranceClaimPaid(claim!.id);

    entries = await prisma.ledgerEntry.findMany({ where: { therapySessionId: session.id } });
    byType = Object.fromEntries(entries.map((e) => [e.entryType, e.amountCents]));
    expect(byType.THERAPY_SESSION_THERAPIST_EARNINGS + byType.THERAPY_SESSION_PLATFORM_FEE).toBe(13000);

    const paidClaim = await prisma.insuranceClaim.findUnique({ where: { sessionId: session.id } });
    expect(paidClaim?.status).toBe("PAID");
  });
});
