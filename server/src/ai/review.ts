import type { AppConfig } from "../config/config";
import type { Logger } from "../logger";
import type { ClaimInput } from "../validators";
import { verifyCitations, type VerifiedCitation } from "./citations";
import type { AiClient } from "./client";
import type { PolicySection } from "./policy";
import { buildPrompt, PROMPT_VERSION } from "./prompt";
import { retrieveSections } from "./retrieval";
import { makeAiOutputSchema, UNCLEAR, type Verdict } from "./schema";

// Runs one AI review of a claim. It never throws: any failure becomes a record
// with status "unavailable" or "invalid_output" so the reviewer can carry on
// manually. The caller stores every record as a new ai_reviews row.

export type AiReviewStatus = "ok" | "unavailable" | "invalid_output";

export interface AiReviewRecord {
  status: AiReviewStatus;
  category: string | null;
  confidence: number | null;
  uncertain: boolean | null;
  verdict: Verdict | null;
  explanation: string | null;
  citedSections: VerifiedCitation[];
  questions: string[];
  model: string;
  promptVersion: string;
  latencyMs: number;
  error: string | null;
  retrievedSectionIds: string[];
}

export interface ReviewDeps {
  client: AiClient;
  policy: PolicySection[];
  config: AppConfig;
  logger: Logger;
  timeoutMs: number;
}

export const MAX_ATTEMPTS = 2; // the first call plus one retry
export const UNAVAILABLE_MESSAGE = "AI unavailable, manual review needed";

class InvalidOutputError extends Error {}

// Model text is usually bare JSON, but tolerate a ```json fence around it.
function extractJson(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  try {
    return JSON.parse(fenced ? fenced[1]! : text);
  } catch {
    throw new InvalidOutputError("Model output is not valid JSON");
  }
}

async function callWithTimeout(
  client: AiClient,
  request: Parameters<AiClient["complete"]>[0],
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`AI call timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    // The race also covers clients that ignore the abort signal.
    return await Promise.race([client.complete(request, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiReview(claim: ClaimInput, deps: ReviewDeps): Promise<AiReviewRecord> {
  const { client, policy, config, logger, timeoutMs } = deps;
  const categoryKeys = Object.keys(config.categories);
  const schema = makeAiOutputSchema(categoryKeys);
  const sections = retrieveSections(claim, policy, config);
  const request = { prompt: buildPrompt(claim, sections, config), claim, sections, categoryKeys };
  const started = Date.now();

  const base = {
    model: client.model,
    promptVersion: PROMPT_VERSION,
    retrievedSectionIds: sections.map((s) => s.id),
  };

  let lastFailure: { status: AiReviewStatus; message: string } = { status: "unavailable", message: "not attempted" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStarted = Date.now();
    try {
      const text = await callWithTimeout(client, request, timeoutMs);
      const parsed = schema.safeParse(extractJson(text));
      if (!parsed.success) {
        throw new InvalidOutputError(`Model output failed schema validation: ${parsed.error.message}`);
      }
      const output = parsed.data;
      logger.info({ attempt, latencyMs: Date.now() - attemptStarted, model: client.model }, "AI review attempt succeeded");

      // The server, not the model, decides what counts as uncertain.
      const uncertain = output.confidence < config.confidenceThreshold || output.category === UNCLEAR;
      const citedSections = verifyCitations(output.cited_sections, policy);
      const { verdict, explanation } = applyCitationRule(output.verdict, output.explanation, citedSections);
      if (verdict !== output.verdict) {
        logger.warn({ citedSections }, "AI citations could not be verified; verdict downgraded to needs_review");
      }

      return {
        ...base,
        status: "ok",
        category: output.category,
        confidence: output.confidence,
        uncertain,
        verdict,
        explanation,
        citedSections,
        questions: output.questions_for_claimant,
        latencyMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastFailure = { status: err instanceof InvalidOutputError ? "invalid_output" : "unavailable", message };
      logger.warn(
        { attempt, latencyMs: Date.now() - attemptStarted, status: lastFailure.status, err: message },
        attempt < MAX_ATTEMPTS ? "AI review attempt failed, retrying once" : "AI review failed after retry",
      );
    }
  }

  return {
    ...base,
    status: lastFailure.status,
    category: null,
    confidence: null,
    uncertain: null,
    verdict: null,
    explanation: UNAVAILABLE_MESSAGE,
    citedSections: [],
    questions: [],
    latencyMs: Date.now() - started,
    error: lastFailure.message,
  };
}

// A finding with no evidence, or with evidence we cannot find in the policy,
// must not reach the reviewer looking trustworthy. Keep it, but send it to
// review and say why in the explanation the reviewer reads.
function applyCitationRule(
  verdict: Verdict,
  explanation: string,
  citations: VerifiedCitation[],
): { verdict: Verdict; explanation: string } {
  const unverified = citations.filter((c) => !c.verified);
  if (citations.length > 0 && unverified.length === 0) return { verdict, explanation };

  const why =
    citations.length === 0
      ? "the AI gave no policy citation"
      : `${unverified.length} cited quote(s) could not be verified against the policy (unverified citation)`;
  const note =
    verdict === "needs_review"
      ? `[System note: ${why}.]`
      : `[System note: verdict changed from "${verdict}" to "needs_review" because ${why}.]`;
  return { verdict: "needs_review", explanation: `${explanation}\n\n${note}` };
}
