import {
  TherapyConsentRecord,
  TherapyConsentStatus,
  TherapyConsentType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Therapy consent is deliberately its own model — never inferred from
 * TermsOfServiceAcceptance or AdConsentRecord (same rule as AD_CONSENT:
 * consent for one purpose is never treated as consent for another).
 *
 * Append-only: every preference change is a new row. Callers must treat the
 * ABSENCE of a consent record as NOT consented (fail closed) — never assume
 * a default of granted.
 */

export interface RecordTherapyConsentInput {
  patientId: string;
  consentType: TherapyConsentType;
  status: TherapyConsentStatus;
  policyVersion: string;
}

export async function recordTherapyConsent(
  input: RecordTherapyConsentInput
): Promise<TherapyConsentRecord> {
  const now = new Date();
  return prisma.therapyConsentRecord.create({
    data: {
      patientId: input.patientId,
      consentType: input.consentType,
      status: input.status,
      policyVersion: input.policyVersion,
      grantedAt: input.status === TherapyConsentStatus.GRANTED ? now : null,
      withdrawnAt: input.status === TherapyConsentStatus.WITHDRAWN ? now : null,
    },
  });
}

export async function getCurrentTherapyConsent(
  patientId: string,
  consentType: TherapyConsentType
): Promise<TherapyConsentRecord | null> {
  return prisma.therapyConsentRecord.findFirst({
    where: { patientId, consentType },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * True only if the patient's current TREATMENT_CONSENT record is GRANTED and
 * has not since been withdrawn. Any other state (no record, WITHDRAWN)
 * resolves to false — this is the gate requestSession() enforces before a
 * session can even be requested.
 */
export async function hasActiveTreatmentConsent(patientId: string): Promise<boolean> {
  const current = await getCurrentTherapyConsent(
    patientId,
    TherapyConsentType.TREATMENT_CONSENT
  );
  if (!current) return false;
  return current.status === TherapyConsentStatus.GRANTED && current.withdrawnAt === null;
}
