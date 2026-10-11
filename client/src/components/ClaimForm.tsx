import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../api";
import type { AppConfig, ClaimInput, ClaimReceipt } from "../types";
import { Card } from "./ui";

// PUBLIC new-claim form (no login). It blocks only what the server would
// refuse (missing or malformed fields). Policy issues like a future date or a
// missing receipt are allowed through, because the server flags them for the
// reviewer. After submitting, the claimant only sees a confirmation with the
// claim number: validation flags and AI output are for reviewers.

interface FormState {
  claimant: string;
  date: string;
  category: string;
  amount: string;
  currency: string;
  description: string;
  receiptAvailable: "" | "yes" | "no";
}

type Errors = Partial<Record<keyof FormState, string>>;

function validateForm(f: FormState): Errors {
  const errors: Errors = {};
  if (!f.claimant.trim()) errors.claimant = "Enter the claimant's name";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errors.date = "Choose the expense date";
  if (!f.category) errors.category = "Choose a category";
  const amount = Number(f.amount);
  if (f.amount.trim() === "" || !Number.isFinite(amount)) errors.amount = "Enter an amount";
  else if (amount <= 0) errors.amount = "Amount must be greater than zero";
  if (!f.currency) errors.currency = "Choose a currency";
  if (!f.description.trim()) errors.description = "Describe the business purpose";
  else if (f.description.length > 1000) errors.description = "Keep the description under 1000 characters";
  if (!f.receiptAvailable) errors.receiptAvailable = "Say whether a receipt is available";
  return errors;
}

export function ClaimForm({ config }: { config: AppConfig }) {
  const emptyForm: FormState = {
    claimant: "",
    date: "",
    category: "",
    amount: "",
    currency: config.baseCurrency,
    description: "",
    receiptAvailable: "",
  };
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ClaimReceipt>();

  const set = (field: keyof FormState) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((errs) => ({ ...errs, [field]: undefined })); // clear the error once the user edits
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const claim: ClaimInput = {
      claimant: form.claimant.trim(),
      date: form.date,
      category: form.category,
      amount: Number(form.amount),
      currency: form.currency,
      description: form.description.trim(),
      receiptAvailable: form.receiptAvailable === "yes",
    };
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      setReceipt(await api.createClaim(claim));
      setForm(emptyForm);
    } catch (err) {
      // Map server field errors back onto the form when possible.
      if (err instanceof ApiError) setErrors(err.fieldErrors() as Errors);
      setSubmitError(err instanceof Error ? err.message : "Could not submit the claim");
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <Card title="Claim submitted">
        <div className="confirmation" role="status">
          <p className="confirmation-number">Claim #{receipt.claimNumber}</p>
          <p>Thank you. Your claim has been received and a reviewer will look at it. Keep the claim number for reference.</p>
          <button type="button" className="btn btn-primary" onClick={() => setReceipt(undefined)}>
            Submit another claim
          </button>
        </div>
      </Card>
    );
  }

  const limit = config.categories.find((c) => c.key === form.category)?.perClaimLimit;

  return (
    <Card title="Submit a claim">
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Claimant" error={errors.claimant} hint="Name of the employee who spent the money">
          <input value={form.claimant} onChange={set("claimant")} maxLength={100} placeholder="e.g. Asha Rao" autoFocus />
        </Field>

        <div className="form-row">
          <Field label="Expense date" error={errors.date} hint="The day the money was spent, not today's date">
            <input type="date" value={form.date} onChange={set("date")} />
          </Field>
          <Field
            label="Category"
            error={errors.category}
            hint={limit ? `Limit ${config.baseCurrency} ${limit} per claim` : "Pick the closest match; the reviewer can change it"}
          >
            <select value={form.category} onChange={set("category")}>
              <option value="">Choose…</option>
              {config.categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="form-row">
          <Field label="Amount" error={errors.amount} hint="As shown on the receipt, in the currency paid">
            <input type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={set("amount")} placeholder="e.g. 1250" />
          </Field>
          <Field label="Currency" error={errors.currency}>
            <select value={form.currency} onChange={set("currency")}>
              {config.currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Description and business purpose"
          error={errors.description}
          hint="What was it for? Include client name or trip details."
        >
          <textarea
            rows={3}
            value={form.description}
            onChange={set("description")}
            maxLength={1000}
            placeholder="e.g. Taxi from Bengaluru airport to the Acme Retail office for the contract review"
          />
        </Field>

        <Field
          group
          label="Receipt available?"
          error={errors.receiptAvailable}
          hint={`Required above ${config.baseCurrency} ${config.receiptRequiredAbove}`}
        >
          <div className="radio-group" role="radiogroup">
            {(["yes", "no"] as const).map((v) => (
              <label key={v} className="radio">
                <input type="radio" name="receipt" value={v} checked={form.receiptAvailable === v} onChange={set("receiptAvailable")} />
                {v === "yes" ? "Yes" : "No"}
              </label>
            ))}
          </div>
        </Field>

        {submitError && (
          <div className="alert alert-error" role="alert">
            {submitError}
          </div>
        )}

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit claim"}
          </button>
        </div>
      </form>
    </Card>
  );
}

// A labelled input with its error or hint. `group` renders a fieldset, which
// is the accessible wrapper for a set of radio buttons.
function Field(props: { label: string; error?: string; hint?: string; group?: boolean; children: ReactNode }) {
  const message = props.error ? (
    <span className="field-error">{props.error}</span>
  ) : (
    props.hint && <span className="field-hint">{props.hint}</span>
  );
  const className = `field ${props.error ? "has-error" : ""}`;
  if (props.group) {
    return (
      <fieldset className={className}>
        <legend className="field-label">{props.label}</legend>
        {props.children}
        {message}
      </fieldset>
    );
  }
  return (
    <div className={className}>
      <label>
        <span className="field-label">{props.label}</span>
        {props.children}
      </label>
      {message}
    </div>
  );
}
