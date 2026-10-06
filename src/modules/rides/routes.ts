import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import * as RidesService from "./service";

export const ridesRouter = Router();

ridesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const ride = await RidesService.requestRide(req.body);
    res.status(201).json(ride);
  })
);

ridesRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const { driverId, vehicleId } = req.body;
    const ride = await RidesService.acceptRide(req.params.id, driverId, vehicleId);
    res.json(ride);
  })
);

ridesRouter.post(
  "/:id/start",
  asyncHandler(async (req, res) => {
    const ride = await RidesService.startRide(req.params.id);
    res.json(ride);
  })
);

ridesRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const { distanceMiles, durationMinutes } = req.body;
    const ride = await RidesService.completeRide(req.params.id, {
      distanceMiles,
      durationMinutes,
    });
    res.json(ride);
  })
);

ridesRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { cancelledBy, reason } = req.body;
    const ride = await RidesService.cancelRide(req.params.id, cancelledBy, reason);
    res.json(ride);
  })
);

ridesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const ride = await RidesService.getRide(req.params.id);
    res.json(ride);
  })
);
