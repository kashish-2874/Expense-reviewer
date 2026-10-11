import { Router } from "express";
import { z } from "zod";
import { reviewerOnly } from "../auth/middleware";
import { createClaim } from "../claims/createClaim";
import {
  CLAIM_STATUSES,
  listAiReviews,
  listAuditEvents,
  listClaimsPage,
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

// Query strings arrive as text, so numbers are coerced ("2" -> 2) and then
// checked: "abc", "1.5", 0 and anything over the cap are all 400s.
export const MAX_PAGE_SIZE = 50;
const listQuerySchema = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});

export function claimsRouter({ store, config, today, auth }: AppDeps): Router {
  const router = Router();
  const { db } = store;
  const reviewer = reviewerOnly(auth.jwtSecret);

  // PUBLIC: anyone can submit a claim. The response is only a receipt (number
  // and status) so the public endpoint cannot be used to read claim data,
  // validation flags or AI output.
  router.post("/", async (req, res) => {
    const input = parseInput(createClaimSchema, req.body);
    const claimNumber = await createClaim(store, config, input, today());
    req.log.info({ claimId: claimNumber }, "Claim created");
    res.status(201).json({ claimNumber, status: "submitted" });
  });

  // Everything below is the reviewer area.
  router.get("/", ...reviewer, async (req, res) => {
    // Response: { items, page, limit, total, totalPages }
    res.json(await listClaimsPage(db, parseInput(listQuerySchema, req.query)));
  });

  router.get("/:id", ...reviewer, async (req, res) => {
    const id = parseClaimId(req.params.id);
    const claim = await requireClaim(store, id);
    const [validationResults, aiReviews, decisions, auditEvents] = await Promise.all([
      listValidationResults(db, id),
      listAiReviews(db, id), // newest first
      listDecisions(db, id), // newest first
      listAuditEvents(db, id), // newest first
    ]);
    res.json({ ...claim, validationResults, aiReviews, decisions, auditEvents });
  });

  return router;
}
