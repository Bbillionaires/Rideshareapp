import { Router } from "express";
import { SponsorshipProgramStatus } from "@prisma/client";
import { asyncHandler } from "../../lib/http";
import * as SponsorshipsService from "./service";

export const sponsorshipsRouter = Router();

// ---- Sponsors ----

sponsorshipsRouter.post(
  "/sponsors",
  asyncHandler(async (req, res) => {
    const sponsor = await SponsorshipsService.createSponsor(req.body);
    res.status(201).json(sponsor);
  })
);

sponsorshipsRouter.get(
  "/sponsors",
  asyncHandler(async (_req, res) => {
    const sponsors = await SponsorshipsService.listSponsors();
    res.json(sponsors);
  })
);

sponsorshipsRouter.get(
  "/sponsors/:id",
  asyncHandler(async (req, res) => {
    const sponsor = await SponsorshipsService.getSponsor(req.params.id);
    res.json(sponsor);
  })
);

sponsorshipsRouter.patch(
  "/sponsors/:id",
  asyncHandler(async (req, res) => {
    const sponsor = await SponsorshipsService.updateSponsor(req.params.id, req.body);
    res.json(sponsor);
  })
);

// ---- Sponsorship programs ----

sponsorshipsRouter.post(
  "/programs",
  asyncHandler(async (req, res) => {
    const program = await SponsorshipsService.createProgram(req.body);
    res.status(201).json(program);
  })
);

sponsorshipsRouter.get(
  "/programs",
  asyncHandler(async (req, res) => {
    const { sponsorId, status } = req.query;
    const programs = await SponsorshipsService.listPrograms({
      sponsorId: typeof sponsorId === "string" ? sponsorId : undefined,
      status: typeof status === "string" ? (status as SponsorshipProgramStatus) : undefined,
    });
    res.json(programs);
  })
);

sponsorshipsRouter.get(
  "/programs/:id",
  asyncHandler(async (req, res) => {
    const program = await SponsorshipsService.getProgram(req.params.id);
    res.json(program);
  })
);

sponsorshipsRouter.patch(
  "/programs/:id",
  asyncHandler(async (req, res) => {
    const program = await SponsorshipsService.updateProgram(req.params.id, req.body);
    res.json(program);
  })
);

sponsorshipsRouter.get(
  "/programs/:id/contributions",
  asyncHandler(async (req, res) => {
    const contributions = await SponsorshipsService.listContributionsForProgram(req.params.id);
    res.json(contributions);
  })
);
