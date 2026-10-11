import { Router } from "express";
import { runAiReview } from "../ai/review";
import { auditedChange } from "../audit/audit";
import { reviewerOnly } from "../auth/middleware";
import { FINAL_STATUSES, getAiReview, getClaim, insertAiReview, updateClaimStatus } from "../db/repository";
import { HttpError } from "../errors";
import { parseClaimId, requireClaim, type AppDeps } from "./shared";

export function reviewRouter({ store, config, policy, aiClient, aiTimeoutMs, auth }: AppDeps): Router {
  const router = Router();
  const { db } = store;

  // Runs the AI advisor. A failed AI call still returns 201 with a stored
  // "unavailable" review, because that outcome is part of the claim's history.
  // The request body is ignored: who triggered it comes from the session.
  router.post("/:id/review", ...reviewerOnly(auth.jwtSecret), async (req, res) => {
    const id = parseClaimId(req.params.id);
    const actor = req.user!.username; // set by requireAuth
    const claim = await requireClaim(store, id);
    if (FINAL_STATUSES.includes(claim.status)) {
      throw new HttpError(409, `Claim ${id} is already ${claim.status}; AI review is no longer useful`);
    }

    const log = req.log.child({ claimId: id });
    // The AI call happens outside the transaction: it can take seconds, and a
    // transaction should only hold database work.
    const record = await runAiReview(claim, { client: aiClient, policy, config, logger: log, timeoutMs: aiTimeoutMs });

    const saved = await auditedChange(
      store,
      async (session) => {
        const reviewId = await insertAiReview(db, id, record, session);
        // Re-read: a decision may have landed while the AI call was running.
        const current = await getClaim(db, id, session);
        if (current?.status === "submitted") await updateClaimStatus(db, id, "under_review", session);
        return { reviewId, statusAfter: current?.status === "submitted" ? "under_review" : current?.status };
      },
      ({ reviewId, statusAfter }) => ({
        claimNumber: id,
        actor,
        action: "ai_review_run",
        before: { status: claim.status },
        after: {
          aiReviewId: reviewId,
          aiStatus: record.status,
          category: record.category,
          verdict: record.verdict,
          uncertain: record.uncertain,
          model: record.model,
          promptVersion: record.promptVersion,
          retrievedSections: record.retrievedSectionIds,
          status: statusAfter,
        },
      }),
    );

    log.info({ aiReviewId: saved.reviewId, aiStatus: record.status, aiLatencyMs: record.latencyMs }, "AI review stored");
    res.status(201).json(await getAiReview(db, saved.reviewId));
  });

  return router;
}
