import { Router } from "express";
import { TherapyConsentType } from "@prisma/client";
import { asyncHandler } from "../../lib/http";
import { recordTherapyConsent, getCurrentTherapyConsent } from "./consent";
import { createSafeRoute, listSafeRoutesForTherapist, deactivateSafeRoute } from "./safe-routes";
import * as TherapyRidesService from "./service";

export const therapyRidesRouter = Router();

// ----------------------------------------------------------------------------
// Consent (kept separate from ToS and ad consent — see consent.ts)
// ----------------------------------------------------------------------------

therapyRidesRouter.post(
  "/consent",
  asyncHandler(async (req, res) => {
    const record = await recordTherapyConsent(req.body);
    res.status(201).json(record);
  })
);

therapyRidesRouter.get(
  "/consent/current",
  asyncHandler(async (req, res) => {
    const { patientId, consentType } = req.query as {
      patientId?: string;
      consentType?: TherapyConsentType;
    };
    const current = await getCurrentTherapyConsent(
      patientId as string,
      (consentType as TherapyConsentType) ?? TherapyConsentType.TREATMENT_CONSENT
    );
    res.json({ current });
  })
);

// ----------------------------------------------------------------------------
// Therapists + their vetted safe routes
// ----------------------------------------------------------------------------

therapyRidesRouter.post(
  "/therapists",
  asyncHandler(async (req, res) => {
    const therapist = await TherapyRidesService.createTherapist(req.body);
    res.status(201).json(therapist);
  })
);

therapyRidesRouter.get(
  "/therapists/:id",
  asyncHandler(async (req, res) => {
    const therapist = await TherapyRidesService.getTherapist(req.params.id);
    res.json(therapist);
  })
);

therapyRidesRouter.post(
  "/therapists/:id/safe-routes",
  asyncHandler(async (req, res) => {
    const route = await createSafeRoute({ ...req.body, therapistId: req.params.id });
    res.status(201).json(route);
  })
);

therapyRidesRouter.get(
  "/therapists/:id/safe-routes",
  asyncHandler(async (req, res) => {
    const routes = await listSafeRoutesForTherapist(req.params.id);
    res.json(routes);
  })
);

therapyRidesRouter.post(
  "/safe-routes/:id/deactivate",
  asyncHandler(async (req, res) => {
    const route = await deactivateSafeRoute(req.params.id);
    res.json(route);
  })
);

// ----------------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------------

therapyRidesRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const session = await TherapyRidesService.requestSession(req.body);
    res.status(201).json(session);
  })
);

therapyRidesRouter.get(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const session = await TherapyRidesService.getSession(req.params.id);
    res.json(session);
  })
);

therapyRidesRouter.post(
  "/sessions/:id/select-route",
  asyncHandler(async (req, res) => {
    const session = await TherapyRidesService.selectRoute(req.params.id, req.body.routeOfferId);
    res.json(session);
  })
);

therapyRidesRouter.post(
  "/sessions/:id/cancel",
  asyncHandler(async (req, res) => {
    const session = await TherapyRidesService.cancelSession(req.params.id);
    res.json(session);
  })
);

// ----------------------------------------------------------------------------
// Insurance claims (manual settlement — see engine.ts known gaps)
// ----------------------------------------------------------------------------

therapyRidesRouter.post(
  "/insurance-claims/:id/mark-paid",
  asyncHandler(async (req, res) => {
    await TherapyRidesService.markInsuranceClaimPaid(req.params.id);
    res.status(204).send();
  })
);
