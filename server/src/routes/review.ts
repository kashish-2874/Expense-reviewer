import { Router } from "express";
import { z } from "zod";
import { runAiReview } from "../ai/review";
import { auditedChange } from "../audit/audit";
import { FINAL_STATUSES, getAiReview, getClaim, insertAiReview, updateClaimStatus } from "../db/repository";
import { HttpError, parseInput } from "../errors";
import { parseClaimId, requireClaim, reviewerName, type AppDeps } from "./shared";

const reviewRequestSchema = z.object({ reviewer: reviewerName.optional() });

export function reviewRouter({ db, config, policy, aiClient, aiTimeoutMs }: AppDeps): Router {
  const router = Router();

  // Runs the AI advisor. A failed AI call still returns 201 with a stored
  // "unavailable" review, because that outcome is part of the claim's history.
  router.post("/:id/review", async (req, res) => {
    const id = parseClaimId(req.params.id);
    const { reviewer } = parseInput(reviewRequestSchema, req.body ?? {});
    const claim = requireClaim(db, id);
    if (FINAL_STATUSES.includes(claim.status)) {
      throw new HttpError(409, `Claim ${id} is already ${claim.status}; AI review is no longer useful`);
    }

    const log = req.log.child({ claimId: id });
    const record = await runAiReview(claim, { client: aiClient, policy, config, logger: log, timeoutMs: aiTimeoutMs });

    const reviewId = auditedChange(
      db,
      () => {
        const reviewRowId = insertAiReview(db, id, record);
        // Re-read: a decision may have landed while the AI call was running.
        if (getClaim(db, id)?.status === "submitted") updateClaimStatus(db, id, "under_review");
        return reviewRowId;
      },
      (reviewRowId) => ({
        claimId: id,
        actor: reviewer ?? "system",
        action: "ai_review_run",
        before: { status: claim.status },
        after: {
          aiReviewId: reviewRowId,
          aiStatus: record.status,
          category: record.category,
          verdict: record.verdict,
          uncertain: record.uncertain,
          model: record.model,
          promptVersion: record.promptVersion,
          retrievedSections: record.retrievedSectionIds,
          status: getClaim(db, id)?.status,
        },
      }),
    );

    log.info({ aiReviewId: reviewId, aiStatus: record.status, aiLatencyMs: record.latencyMs }, "AI review stored");
    res.status(201).json(getAiReview(db, reviewId));
  });

  return router;
}
