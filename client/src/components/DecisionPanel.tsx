import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { AppConfig, ClaimDetail, DecisionAction } from "../types";

// The reviewer's actions. Choosing an action opens a short form; reject,
// clarification and override need a reason (the server enforces the same rules).

const ACTIONS: { action: DecisionAction; label: string; className: string }[] = [
  { action: "approve", label: "Approve", className: "btn-approve" },
  { action: "reject", label: "Reject", className: "btn-reject" },
  { action: "request_clarification", label: "Request clarification", className: "" },
  { action: "override_category", label: "Override category", className: "" },
];

interface Props {
  claim: ClaimDetail;
  config: AppConfig;
  reviewer: string;
  onDone: () => void;
}

export function DecisionPanel({ claim, config, reviewer, onDone }: Props) {
  const [action, setAction] = useState<DecisionAction>();
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const isFinal = claim.status === "approved" || claim.status === "rejected";
  const hasErrors = claim.validationResults.some((r) => r.severity === "error");
  const currentCategory = claim.finalCategory ?? claim.category;
  const reasonRequired = action !== undefined && (action !== "approve" || hasErrors);

  if (isFinal) {
    const final = claim.decisions.find((d) => d.action === "approve" || d.action === "reject");
    return (
      <p className="muted">
        This claim is {claim.status}
        {final && ` by ${final.reviewer}`}. No further actions are possible.
      </p>
    );
  }

  const choose = (a: DecisionAction) => {
    setAction(a === action ? undefined : a);
    setError(undefined);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!action) return;
    if (!reviewer.trim()) return setError("Enter your reviewer name above first.");
    if (reasonRequired && !reason.trim()) return setError("Please give a reason.");
    if (action === "override_category" && !category) return setError("Choose the new category.");

    setSaving(true);
    setError(undefined);
    try {
      await api.decide(claim.id, {
        reviewer: reviewer.trim(),
        action,
        reason: reason.trim() || undefined,
        overrideCategory: action === "override_category" ? category : undefined,
      });
      setAction(undefined);
      setReason("");
      setCategory("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the decision");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="decision-panel">
      <div className="row wrap">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            className={`btn ${a.className} ${action === a.action ? "active" : ""}`}
            aria-pressed={action === a.action}
            onClick={() => choose(a.action)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {action && (
        <form className="form decision-form" onSubmit={submit} noValidate>
          {action === "override_category" && (
            <label>
              <span className="field-label">New category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose…</option>
                {config.categories
                  .filter((c) => c.key !== currentCategory)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            <span className="field-label">
              Reason {reasonRequired ? "(required)" : "(optional)"}
            </span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </label>
          {action === "approve" && hasErrors && (
            <p className="field-hint">This claim has validation errors, so approving it needs a reason.</p>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : `Confirm: ${ACTIONS.find((a) => a.action === action)?.label}`}
            </button>
            <button type="button" className="btn btn-link" onClick={() => choose(action)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
