import { AdConsentRecord, AdConsentStatus, AdConsentType, AdViewerType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/http";

/**
 * AD_CONSENT module: tracks rider/driver advertising preferences, kept
 * strictly separate from TermsOfServiceAcceptance. Accepting the general
 * Terms of Service must NEVER be treated as consent to personalized (or any)
 * advertising — the two models are deliberately unrelated and this module
 * never reads TermsOfServiceAcceptance to infer ad consent.
 *
 * AdConsentRecord is append-only: every preference change is a new row so
 * full history is preserved. Callers must treat the ABSENCE of a consent
 * record as NOT consented (fail closed) — never assume a default of granted.
 */

function assertExactlyOneSubject(driverId?: string | null, riderId?: string | null) {
  if ((driverId && riderId) || (!driverId && !riderId)) {
    badRequest("Exactly one of driverId or riderId must be provided");
  }
}

export interface RecordConsentInput {
  driverId?: string | null;
  riderId?: string | null;
  consentType: AdConsentType;
  status: AdConsentStatus;
  policyVersion: string;
  sourceScreen?: string | null;
}

/**
 * Always INSERTS a new AdConsentRecord row — never updates an existing one.
 * A later record for the same (user, consentType) supersedes the earlier one
 * purely by having a later createdAt; see getCurrentConsent.
 */
export async function recordConsent(input: RecordConsentInput): Promise<AdConsentRecord> {
  assertExactlyOneSubject(input.driverId, input.riderId);

  const now = new Date();
  return prisma.adConsentRecord.create({
    data: {
      driverId: input.driverId ?? null,
      riderId: input.riderId ?? null,
      consentType: input.consentType,
      status: input.status,
      policyVersion: input.policyVersion,
      sourceScreen: input.sourceScreen ?? null,
      grantedAt: input.status === AdConsentStatus.GRANTED ? now : null,
      withdrawnAt: input.status === AdConsentStatus.WITHDRAWN ? now : null,
    },
  });
}

export interface GetCurrentConsentInput {
  driverId?: string | null;
  riderId?: string | null;
  consentType: AdConsentType;
}

/**
 * Returns the most recent AdConsentRecord (by createdAt) for this user +
 * consentType, or null if none exists. IMPORTANT: null must be treated by
 * every caller as "not consented" — never as an implicit grant.
 */
export async function getCurrentConsent(
  input: GetCurrentConsentInput
): Promise<AdConsentRecord | null> {
  assertExactlyOneSubject(input.driverId, input.riderId);

  return prisma.adConsentRecord.findFirst({
    where: {
      driverId: input.driverId ?? undefined,
      riderId: input.riderId ?? undefined,
      consentType: input.consentType,
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface HasPersonalizedAdConsentInput {
  driverId?: string | null;
  riderId?: string | null;
}

/**
 * Convenience helper for the ADVERTISING module: true only if the current
 * PERSONALIZED_OFFERS record is GRANTED and has not since been withdrawn.
 * Any other state (no record, DENIED, WITHDRAWN) resolves to false.
 */
export async function hasPersonalizedAdConsent(
  input: HasPersonalizedAdConsentInput
): Promise<boolean> {
  const current = await getCurrentConsent({
    driverId: input.driverId,
    riderId: input.riderId,
    consentType: AdConsentType.PERSONALIZED_OFFERS,
  });
  if (!current) return false;
  return current.status === AdConsentStatus.GRANTED && current.withdrawnAt === null;
}

export interface RecordTosAcceptanceInput {
  userId: string;
  userType: AdViewerType;
  policyVersion: string;
}

/**
 * Records acceptance of the general Terms of Service. This is intentionally
 * a completely separate model/flow from advertising consent above — ToS
 * acceptance must NEVER be read, derived from, or treated as advertising
 * consent of any kind (personalized or non-personalized). Do not add any
 * code path that infers AdConsentRecord state from this table.
 */
export async function recordTosAcceptance(input: RecordTosAcceptanceInput) {
  return prisma.termsOfServiceAcceptance.create({
    data: {
      userId: input.userId,
      userType: input.userType,
      policyVersion: input.policyVersion,
    },
  });
}
