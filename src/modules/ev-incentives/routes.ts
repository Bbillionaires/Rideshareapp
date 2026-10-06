import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import * as EvAdminService from "./admin.service";
import { getEvVsNonEvAnalytics } from "./analytics";

export const evIncentivesRouter = Router();

// Specific routes first so they aren't swallowed by the "/:id" rule param below.

evIncentivesRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { from, to, marketId, driverId } = req.query;
    const result = await getEvVsNonEvAnalytics({
      from: typeof from === "string" ? new Date(from) : undefined,
      to: typeof to === "string" ? new Date(to) : undefined,
      marketId: typeof marketId === "string" ? marketId : undefined,
      driverId: typeof driverId === "string" ? driverId : undefined,
    });
    res.json(result);
  })
);

evIncentivesRouter.get(
  "/rides/:rideId/bonus",
  asyncHandler(async (req, res) => {
    const summary = await EvAdminService.getRideBonusBreakdown(req.params.rideId);
    res.json(summary);
  })
);

// ---- EvCompensationRule CRUD ----

evIncentivesRouter.post(
  "/rules",
  asyncHandler(async (req, res) => {
    const rule = await EvAdminService.createRule(req.body);
    res.status(201).json(rule);
  })
);

evIncentivesRouter.get(
  "/rules",
  asyncHandler(async (req, res) => {
    const { marketId, serviceTypeId, active, isPromotional } = req.query;
    const rules = await EvAdminService.listRules({
      marketId: typeof marketId === "string" ? marketId : undefined,
      serviceTypeId: typeof serviceTypeId === "string" ? serviceTypeId : undefined,
      active: active === undefined ? undefined : active === "true",
      isPromotional: isPromotional === undefined ? undefined : isPromotional === "true",
    });
    res.json(rules);
  })
);

evIncentivesRouter.get(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const rule = await EvAdminService.getRule(req.params.id);
    res.json(rule);
  })
);

evIncentivesRouter.patch(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const rule = await EvAdminService.updateRule(req.params.id, req.body);
    res.json(rule);
  })
);

evIncentivesRouter.post(
  "/rules/:id/deactivate",
  asyncHandler(async (req, res) => {
    const rule = await EvAdminService.deactivateRule(req.params.id);
    res.json(rule);
  })
);
