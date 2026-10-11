import type { Db, Document, IndexDescription } from "mongodb";
import { VERDICTS } from "../ai/schema";
import { CLAIM_STATUSES, DECISION_ACTIONS, SEVERITIES, USER_ROLES } from "./collections";

// Database-level rules, applied at every startup. They are the second line of
// defence after zod in the API: even code that skips the API (a script, a
// bug) cannot store a bad status or a rejection without a reason.
// Both steps are idempotent: create the collection if missing, else update it.

const text = { bsonType: "string", minLength: 1 };
const nonBlank = { bsonType: "string", pattern: "\\S" }; // at least one non-space character
const date = { bsonType: "date" };
const number = { bsonType: "number" };

const VALIDATORS: Record<string, Document> = {
  claims: {
    bsonType: "object",
    required: ["claimNumber", "claimant", "date", "category", "amount", "currency", "description", "receiptAvailable", "status", "createdAt"],
    properties: {
      claimNumber: number,
      claimant: text,
      date: text,
      category: text,
      amount: number,
      currency: text,
      description: text,
      receiptAvailable: { bsonType: "bool" },
      status: { enum: [...CLAIM_STATUSES] },
      finalCategory: { bsonType: ["string", "null"] },
      createdAt: date,
    },
  },
  validation_results: {
    bsonType: "object",
    required: ["claimNumber", "checkName", "severity", "message", "createdAt"],
    properties: { claimNumber: number, checkName: text, severity: { enum: [...SEVERITIES] }, message: text, createdAt: date },
  },
  ai_reviews: {
    bsonType: "object",
    required: ["claimNumber", "status", "model", "promptVersion", "createdAt"],
    properties: {
      claimNumber: number,
      status: { enum: ["ok", "unavailable", "invalid_output"] },
      verdict: { enum: [...VERDICTS, null] },
      createdAt: date,
    },
  },
  decisions: {
    bsonType: "object",
    required: ["claimNumber", "reviewer", "action", "createdAt"],
    properties: { claimNumber: number, reviewer: text, action: { enum: [...DECISION_ACTIONS] }, createdAt: date },
    allOf: [
      // Only "approve" may be recorded without a reason.
      { anyOf: [{ properties: { action: { enum: ["approve"] } } }, { required: ["reason"], properties: { reason: nonBlank } }] },
      // An override must say which category it changes to.
      {
        anyOf: [
          { properties: { action: { not: { enum: ["override_category"] } } } },
          { required: ["overrideCategory"], properties: { overrideCategory: text } },
        ],
      },
    ],
  },
  audit_events: {
    bsonType: "object",
    required: ["actor", "action", "createdAt"],
    properties: { claimNumber: { bsonType: ["number", "null"] }, actor: text, action: text, createdAt: date },
  },
  users: {
    bsonType: "object",
    required: ["username", "passwordHash", "role", "createdAt"],
    properties: { username: text, passwordHash: text, role: { enum: [...USER_ROLES] }, createdAt: date },
  },
};

const INDEXES: Record<string, IndexDescription[]> = {
  claims: [
    { key: { claimNumber: 1 }, unique: true },
    { key: { status: 1, createdAt: -1 } }, // filtered, newest-first list
    { key: { createdAt: -1 } }, // unfiltered, newest-first list
  ],
  validation_results: [{ key: { claimNumber: 1, createdAt: -1 } }],
  ai_reviews: [{ key: { claimNumber: 1, createdAt: -1 } }],
  decisions: [{ key: { claimNumber: 1, createdAt: -1 } }],
  audit_events: [{ key: { claimNumber: 1, createdAt: -1 } }],
  users: [{ key: { username: 1 }, unique: true }],
};

export async function setupDatabase(db: Db): Promise<void> {
  await applyValidators(db);
  for (const [name, indexes] of Object.entries(INDEXES)) {
    await db.collection(name).createIndexes(indexes); // no-op when they already exist
  }
}

async function applyValidators(db: Db): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, schema] of Object.entries(VALIDATORS)) {
    const options = { validator: { $jsonSchema: schema }, validationLevel: "strict", validationAction: "error" } as const;
    if (existing.has(name)) {
      await db.command({ collMod: name, ...options });
    } else {
      await db.createCollection(name, options);
    }
  }
}
