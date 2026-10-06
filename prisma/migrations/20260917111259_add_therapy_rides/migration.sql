-- CreateEnum
CREATE TYPE "TherapyConsentType" AS ENUM ('TREATMENT_CONSENT', 'IN_VEHICLE_SESSION_CONSENT');

-- CreateEnum
CREATE TYPE "TherapyConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TherapySessionStatus" AS ENUM ('REQUESTED', 'ROUTE_OFFERED', 'ROUTE_SELECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TherapyPayerType" AS ENUM ('SELF_PAY', 'INSURANCE', 'EMPLOYER_SPONSORED');

-- CreateEnum
CREATE TYPE "InsuranceClaimStatus" AS ENUM ('SUBMITTED', 'PAID', 'DENIED');

-- AlterEnum
ALTER TYPE "BoundedModule" ADD VALUE 'THERAPY_RIDES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'THERAPY_SESSION_PATIENT_CHARGE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'THERAPY_SESSION_EMPLOYER_CONTRIBUTION';
ALTER TYPE "LedgerEntryType" ADD VALUE 'THERAPY_SESSION_THERAPIST_EARNINGS';
ALTER TYPE "LedgerEntryType" ADD VALUE 'THERAPY_SESSION_PLATFORM_FEE';

-- AlterEnum
ALTER TYPE "LedgerPartyType" ADD VALUE 'THERAPIST';

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "insuranceClaimId" TEXT,
ADD COLUMN     "therapySessionId" TEXT;

-- CreateTable
CREATE TABLE "therapists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseState" TEXT NOT NULL,
    "npiNumber" TEXT,
    "licenseVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapist_safe_routes" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zoneId" TEXT,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapist_safe_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_consent_records" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consentType" "TherapyConsentType" NOT NULL,
    "status" "TherapyConsentStatus" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_sessions" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "rideId" TEXT,
    "status" "TherapySessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "payerType" "TherapyPayerType" NOT NULL,
    "sponsorId" TEXT,
    "consentRecordId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "therapy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_session_route_offers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "safeRouteId" TEXT NOT NULL,
    "presentedOrder" INTEGER NOT NULL,
    "selectedAt" TIMESTAMP(3),

    CONSTRAINT "therapy_session_route_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "memberIdLast4" TEXT NOT NULL,
    "billedCents" INTEGER NOT NULL,
    "patientResponsibilityCents" INTEGER NOT NULL,
    "status" "InsuranceClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "therapists_email_key" ON "therapists"("email");

-- CreateIndex
CREATE INDEX "therapist_safe_routes_therapistId_active_idx" ON "therapist_safe_routes"("therapistId", "active");

-- CreateIndex
CREATE INDEX "therapy_consent_records_patientId_consentType_idx" ON "therapy_consent_records"("patientId", "consentType");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_sessions_rideId_key" ON "therapy_sessions"("rideId");

-- CreateIndex
CREATE INDEX "therapy_sessions_patientId_idx" ON "therapy_sessions"("patientId");

-- CreateIndex
CREATE INDEX "therapy_sessions_therapistId_idx" ON "therapy_sessions"("therapistId");

-- CreateIndex
CREATE INDEX "therapy_session_route_offers_sessionId_idx" ON "therapy_session_route_offers"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_session_route_offers_sessionId_safeRouteId_key" ON "therapy_session_route_offers"("sessionId", "safeRouteId");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_sessionId_key" ON "insurance_claims"("sessionId");

-- AddForeignKey
ALTER TABLE "therapist_safe_routes" ADD CONSTRAINT "therapist_safe_routes_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_safe_routes" ADD CONSTRAINT "therapist_safe_routes_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_consent_records" ADD CONSTRAINT "therapy_consent_records_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_session_route_offers" ADD CONSTRAINT "therapy_session_route_offers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "therapy_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_session_route_offers" ADD CONSTRAINT "therapy_session_route_offers_safeRouteId_fkey" FOREIGN KEY ("safeRouteId") REFERENCES "therapist_safe_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "therapy_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_therapySessionId_fkey" FOREIGN KEY ("therapySessionId") REFERENCES "therapy_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
