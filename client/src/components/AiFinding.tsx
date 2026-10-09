import { categoryLabel, VERDICT_LABELS } from "../format";
import type { AiReview, AppConfig } from "../types";

// Shows the latest AI review. It is advice for the reviewer: uncertainty and
// unverified citations are made loud on purpose, and a failed run says plainly
// that the claim needs a manual review.

export function AiFinding({ review, config, runCount }: { review?: AiReview; config: AppConfig; runCount: number }) {
  if (!review) {
    return <p className="muted">No AI review yet. Run one for a suggested category, policy evidence and questions.</p>;
  }

  if (review.status !== "ok") {
    return (
      <div className="alert alert-warning" role="alert">
        <strong>AI unavailable, manual review needed.</strong>
        <div className="small">
          {review.status === "invalid_output" ? "The AI returned an unusable answer twice." : "The AI service could not be reached."}{" "}
          {review.error && <code>{review.error}</code>}
        </div>
      </div>
    );
  }

  const isMock = review.model.startsWith("mock");
  const unverified = review.citedSections.filter((c) => !c.verified).length;

  return (
    <div className="ai-finding">
      {isMock && (
        <div className="alert alert-info">
          <strong>Mock AI.</strong> No API key is configured, so this is a placeholder, not a real analysis.
        </div>
      )}
      {review.uncertain && (
        <div className="alert alert-warning" role="alert">
          <strong>Uncertain classification.</strong> The AI is not confident about the category. Check it before deciding.
        </div>
      )}

      <dl className="facts">
        <div>
          <dt>Suggested category</dt>
          <dd>{categoryLabel(config, review.category)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{review.confidence === null ? "—" : `${Math.round(review.confidence * 100)}%`}</dd>
        </div>
        <div>
          <dt>Assessment</dt>
          <dd>{review.verdict && <span className={`badge verdict-${review.verdict}`}>{VERDICT_LABELS[review.verdict]}</span>}</dd>
        </div>
      </dl>

      <p className="explanation">{review.explanation}</p>

      <h3>Policy evidence</h3>
      {unverified > 0 && (
        <p className="field-error">
          {unverified} citation{unverified > 1 && "s"} could not be found in the policy. Do not rely on {unverified > 1 ? "them" : "it"}.
        </p>
      )}
      {review.citedSections.length === 0 ? (
        <p className="muted">No policy sections cited.</p>
      ) : (
        <ul className="citations">
          {review.citedSections.map((c, i) => (
            <li key={i} className={c.verified ? "verified" : "unverified"}>
              <span className={`badge ${c.verified ? "verified" : "severity-error"}`}>
                {c.verified ? "✓ Verified" : "✗ Unverified"}
              </span>{" "}
              <strong>§{c.section}</strong> <q>{c.quote}</q>
              {c.reason && <div className="small muted">{c.reason}</div>}
            </li>
          ))}
        </ul>
      )}

      {review.questions.length > 0 && (
        <>
          <h3>Questions for the claimant</h3>
          <ul>
            {review.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small">
        {review.model} · prompt {review.promptVersion} · {review.latencyMs} ms
        {runCount > 1 && ` · latest of ${runCount} runs (see history)`}. Advisory only: the reviewer makes the decision.
      </p>
    </div>
  );
}
