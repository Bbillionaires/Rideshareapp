import { Router } from "express";
import { AdConsentType } from "@prisma/client";
import { asyncHandler } from "../../lib/http";
import * as AdConsentService from "./service";

export const adConsentRouter = Router();

// Record a new consent decision (grant/deny/withdraw). Always inserts a new
// row — see service.ts for why history is never mutated in place.
adConsentRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const record = await AdConsentService.recordConsent(req.body);
    res.status(201).json(record);
  })
);

// Current consent state for a user + consent type. Returns { current: null }
// when no record exists — the caller must treat that as NOT consented.
adConsentRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const { driverId, riderId, consentType } = req.query as {
      driverId?: string;
      riderId?: string;
      consentType?: AdConsentType;
    };
    const current = await AdConsentService.getCurrentConsent({
      driverId,
      riderId,
      consentType: consentType as AdConsentType,
    });
    res.json({ current });
  })
);

// Convenience check used by the ADVERTISING module (and back-office tooling)
// to decide whether location/behavior-based targeting is allowed for a user.
adConsentRouter.get(
  "/personalized-status",
  asyncHandler(async (req, res) => {
    const { driverId, riderId } = req.query as { driverId?: string; riderId?: string };
    const hasConsent = await AdConsentService.hasPersonalizedAdConsent({ driverId, riderId });
    res.json({ hasPersonalizedConsent: hasConsent });
  })
);

// Separate from ad consent entirely — see service.ts's prominent warning.
adConsentRouter.post(
  "/tos-acceptance",
  asyncHandler(async (req, res) => {
    const acceptance = await AdConsentService.recordTosAcceptance(req.body);
    res.status(201).json(acceptance);
  })
);
