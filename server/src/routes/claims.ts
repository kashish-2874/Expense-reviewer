import { Router } from "express";
import { z } from "zod";
import { createClaim } from "../claims/createClaim";
import {
  CLAIM_STATUSES,
  getClaim,
  listAiReviews,
  listAuditEvents,
  listClaims,
  listDecisions,
  listValidationResults,
} from "../db/repository";
import { parseInput } from "../errors";
import { parseClaimId, requireClaim, type AppDeps } from "./shared";

// The API only rejects input that cannot be a claim at all (missing fields,
// wrong types). Business-rule problems such as a future date or an over-limit
// amount are stored and flagged for the reviewer instead of being refused.
const createClaimSchema = z.object({
  claimant: z.string().trim().min(1).max(100),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  category: z.string().trim().min(1).max(50),
  amount: z.number().positive().max(10_000_000),
  currency: z.string().trim().toUpperCase().length(3),
  description: z.string().trim().min(1).max(1000),
  receiptAvailable: z.boolean(),
});

const listQuerySchema = z.object({ status: z.enum(CLAIM_STATUSES).optional() });

export function claimsRouter({ db, config, today }: AppDeps): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const input = parseInput(createClaimSchema, req.body);
    const id = createClaim(db, config, input, today());
    req.log.info({ claimId: id }, "Claim created");
    res.status(201).json({ ...getClaim(db, id), validationResults: listValidationResults(db, id) });
  });

  router.get("/", (req, res) => {
    const { status } = parseInput(listQuerySchema, req.query);
    res.json(listClaims(db, status));
  });

  router.get("/:id", (req, res) => {
    const id = parseClaimId(req.params.id);
    const claim = requireClaim(db, id);
    res.json({
      ...claim,
      validationResults: listValidationResults(db, id),
      aiReviews: listAiReviews(db, id), // newest first
      decisions: listDecisions(db, id), // newest first
      auditEvents: listAuditEvents(db, id), // newest first
    });
  });

  return router;
}
