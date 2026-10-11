# Expense Claim Review

An internal web app for a finance reviewer who checks employee expense claims against the company expense policy.

Each claim goes through three layers, and each layer has a different job:

| Layer | Who | What it does | Can it decide? |
|---|---|---|---|
| **Rules** | Plain TypeScript | Duplicates, totals, missing receipts, category limits, dates and required fields | No. It flags problems for the reviewer. |
| **AI advisor** | Claude, via the Anthropic API | Suggests a category, finds the relevant policy clauses, explains the likely outcome, quotes its evidence and lists questions for the claimant | No. Its output is advice, and it is checked before it is shown. |
| **Reviewer** | A logged-in person | Approves, rejects, asks for clarification, or overrides the category | Yes, and every action is logged under their account. |

The app does not reimburse anyone and does not give financial, tax or legal advice.

![Claim list](docs/screenshots/claim-list.png)

## A typical review

1. **Anyone submits a claim** on the public form (claimant, date, category, amount, currency, description, receipt yes/no). They get back only a claim number, for example *"Claim #14 … a reviewer will look at it"*. The rules run immediately and their findings are stored with the claim, for example *"Exact duplicate of claim 1"* or *"INR 2400 exceeds the Meals limit of 1500"*. Problems are flagged, not refused, so the reviewer sees every claim.
2. **The reviewer logs in** and works through a paginated list. Badges show each claim's status, an *Uncertain* flag from the latest AI review, and the number of errors and warnings.
3. **Run AI review.** The server picks the relevant policy clauses, asks Claude for a structured answer, and then checks that answer:
   - Every quoted clause must exist and the quote must really appear in it. Otherwise the citation is marked **✗ Unverified** and the verdict is changed to *Needs review*.
   - The server, not the model, decides whether the classification is **uncertain** (confidence below 0.7, or category "unclear").
   - If the AI is down or returns unusable output twice, the reviewer sees *"AI unavailable, manual review needed"* and can carry on.
4. **Decide.** Approve, Reject, Request clarification or Override category. The page says *"Deciding as kashish"*: the reviewer's name comes from their login, not from a text box. Reject, clarification and override need a reason, which the API and the database both enforce.
5. **History.** Every change (submission, each AI run, each decision, category overrides with before and after) is in an append-only audit log, shown newest first in plain language, with the raw data one click away.

![Claim detail](docs/screenshots/claim-detail.png)

*(Screenshots were taken with the built-in mock AI, which is why the review is labelled "Mock AI".)*

## Architecture

```
 Browser (React + Vite)                     Express API (TypeScript)                          MongoDB (replica set)
 ──────────────────────                     ────────────────────────                          ────────────────────
 PUBLIC  /submit-claim form       ── POST /api/claims ─▶ claims/createClaim ─▶ validators/*    claims, validation_results
         /login     login page   ── POST /api/auth/login ─▶ bcrypt check ─▶ JWT cookie       users
 LOGIN   /claims    list+totals  ── GET  /api/claims?page=&limit=&status=                    counters (claim numbers)
         /claims/9  detail       ── POST /api/claims/9/review ─▶ ai/review:                   ai_reviews (one per run)
                                      retrieval → prompt → AiClient (Anthropic | Mock)
                                      → zod check → citation check → fallback
                    decision     ── POST /api/claims/9/decision                              decisions
                                 every state change ─▶ audit/auditedChange (transaction) ─▶  audit_events (insert-only)
```

### Data model

| Collection | Holds | Notes |
|---|---|---|
| `claims` | One document per claim | `claimNumber` is the human-friendly id the UI and URLs use (`/claims/9`). `finalCategory` is set by a reviewer override; the claimed `category` is never changed. |
| `validation_results` | Rule findings | Linked by `claimNumber`. |
| `ai_reviews` | One document per AI run | Never overwritten, so earlier runs stay in the history. |
| `decisions` | Reviewer actions | `reviewer` is the logged-in username. |
| `audit_events` | Every change, with before and after | Insert-only (see below). |
| `users` | Reviewer accounts | `username`, bcrypt `passwordHash`, `role` (only `admin` today). |
| `counters` | The claim-number sequence | One document, incremented atomically. |

**Claim numbers.** MongoDB ids are 24-character ObjectIds, which are no good for "please look at claim #9". So a `counters` document is incremented with `findOneAndUpdate` + `$inc` (atomic, with upsert), and the result is stored as `claimNumber` with a unique index. The increment happens inside the claim's transaction, which has two benefits: if creating the claim fails, the number is given back (no gaps), and two simultaneous submissions conflict on the counter, so MongoDB retries one of them. That makes claim creation effectively one-at-a-time, which is what lets duplicate detection see a claim submitted a moment earlier. A test creates 15 claims in parallel and checks they get exactly 1 to 15.

**Indexes** (created at startup, safe to repeat): `claims` on `claimNumber` (unique), `{status, createdAt}` and `createdAt` for the filtered and unfiltered newest-first list; `{claimNumber, createdAt}` on the four per-claim collections; `users.username` (unique).

**Transactions.** Every change and its audit event are written in **one** MongoDB transaction (`auditedChange()` with a client session and `withTransaction`). Either both are saved or neither is, so there is never a decision without its audit record or an audit record for something that was rolled back. Tests prove it: when the audit insert is made to fail, the claim or decision is not saved either. MongoDB only allows transactions on a replica set, so the server checks this at startup and refuses to run against a standalone server with a clear error.

**Two layers of rules.** zod validates every request in the API. Behind it, each collection has a MongoDB `$jsonSchema` validator for the things that must never be stored wrong: allowed values for `status`, `action` and `severity`, and *"a reject, clarification or override must have a non-blank reason"*. So even a script that bypasses the API cannot write an invalid decision. Validators and indexes are applied at every startup (`createCollection` or `collMod`).

**Append-only audit log.** SQLite used to enforce this with triggers; MongoDB has no equivalent, so I enforce it in code and check it with tests:
- `audit/auditRepository.ts` is the only module that touches `audit_events`, and it exports exactly two functions, `insertAuditEvent` and `findAuditEvents`. There is no update or delete function anywhere.
- Tests check that it exports only those two functions, that no other source file mentions the collection (setup only creates indexes and validators), and that neither file contains any update, delete or replace call.
- **In production** the app's database user should also have a role without `update`/`remove` privileges on `audit_events`, so the guarantee holds even if the code changes.

The only way to clear the log is `npm run seed -- --reset`, which drops the whole database on purpose (see below).

### Code layout

- **`server/src/validators/`**: pure functions with no I/O and no AI. Config and "today" are passed in.
- **`server/src/ai/`**:
  - `policy.ts` splits `policy.md` into numbered clauses.
  - `retrieval.ts` scores them for a claim.
  - `prompt.ts` holds the prompt and its version.
  - `client.ts` has the AI client interface, with a real (Anthropic) and a mock implementation.
  - `citations.ts` checks quotes against the policy.
  - `review.ts` runs the workflow with a timeout, one retry and the fallback.
- **`server/src/db/`**: the data layer, the only code that uses the MongoDB driver.
  - `mongo.ts`: connection and the transaction check.
  - `setup.ts`: validators and indexes.
  - `collections.ts`: document types.
  - `counters.ts`: claim numbers.
  - `repository.ts`: claims and their records.
  - `users.ts`: reviewer accounts.
- **`server/src/audit/`**: `auditedChange()`, the single way to change state, and the insert-only audit repository.
- **`server/src/auth/`**: passwords, tokens, the `requireAuth` / `requireRole` middleware, the JWT secret check, and admin seeding.
- **`client/src/`**:
  - React components.
  - `api.ts`: a `fetch` wrapper.
  - `auth.tsx`: the login state.
  - `router.tsx`: a small router over the History API.
  - `lib/formatAuditEvent.ts`: the plain-language history.

## Authentication

- **Submitting a claim is public.** No account is needed, and the response is only `{claimNumber, status}`, so the public endpoint can't be used to read claims, flags or AI output.
- **The reviewer area needs a login:** the claim list, claim details, AI reviews, decisions and totals. Without a valid session the API returns 401, and the UI sends you to `/login`, then back to the page you wanted.
- **One admin account, stored in MongoDB.** On startup the server creates it from `ADMIN_USERNAME` and `ADMIN_PASSWORD` if that username does not exist yet. It never overwrites an existing account, so changing `ADMIN_PASSWORD` later does **not** change the stored password. The password is stored only as a bcrypt hash (cost 12) and is never logged. There is no signup and no user management by design; the `role` field exists so roles can be added later.
- **Sessions are a signed JWT in a cookie.** The cookie is `httpOnly` (page scripts can't read it), `sameSite=lax` (not sent on cross-site form posts) and `secure` in production (HTTPS only), and it expires after 8 hours. Tokens are verified with the algorithm pinned to HS256, so `alg: none` and tampered tokens are rejected.
- **Login doesn't reveal which usernames exist.** A wrong password and an unknown username get the same message (*"Invalid username or password"*). Unknown usernames are still checked against a dummy bcrypt hash, so the response takes the same time.
- **The reviewer's identity comes from the session.** Decisions and audit events record the logged-in username. A `reviewer` field sent in a request body is ignored, so nobody can decide in someone else's name.
- **Secrets are refused in production unless real.** The server will not start in production if `JWT_SECRET` is missing or still the `.env.example` placeholder, or if `ADMIN_PASSWORD` is still the placeholder.

## Claims list API (pagination)

`GET /api/claims?page=1&limit=10&status=under_review` (needs a login)

| Parameter | Default | Rules |
|---|---|---|
| `page` | 1 | whole number ≥ 1 |
| `limit` | 10 | whole number from 1 to 50 |
| `status` | *(all)* | `submitted`, `under_review`, `approved`, `rejected`, `clarification_requested` |

Invalid values return the usual 400 `{ "error": "Validation failed", "details": [{ "path": "limit", … }] }`.

```json
{
  "items": [ { "id": 13, "claimant": "Meera Joshi", "status": "submitted",
               "validationCounts": { "error": 1, "warning": 0, "info": 0 },
               "latestAi": null, "...": "..." } ],
  "page": 1, "limit": 10, "total": 13, "totalPages": 2
}
```

- **Ordering:** newest first (`createdAt` descending), with `claimNumber` as a tiebreaker, so the order never shuffles between requests.
- **Totals:** `total` counts only the claims matching the filter.
- **Past the end:** a page past the last one returns empty `items` with correct totals; the UI offers "Go to the last page".
- **Query count:** each item's validation counts and latest AI result are fetched for the whole page at once. That's four queries per page however many claims it holds, and a test checks it.
- **In the UI:** page, page size and filter live in the URL (`/claims?status=approved&limit=25&page=2`), so refresh and the back button work.

## Running it

Requirements: Node.js 20 or 22 (developed on 21.7; 22 LTS recommended), npm, and a MongoDB **replica set**.

### 1. Get a MongoDB

**Option A: MongoDB Atlas (free, nothing to install)**
1. Create a free account at mongodb.com/atlas and create a free (M0) cluster.
2. Under *Database Access*, add a database user with a password.
3. Under *Network Access*, allow your IP address.
4. Click *Connect → Drivers* and copy the `mongodb+srv://…` connection string into `MONGODB_URI`, filling in the user and password.

Atlas clusters are replica sets, so transactions work out of the box.

**Option B: local MongoDB with Docker**
```bash
docker compose up -d      # from the project root; starts mongo:7 as a single-node replica set
```
Then use `MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0`. A plain `mongod` without `--replSet rs0` and `rs.initiate()` will not work, and the server tells you so at startup. (I couldn't run `docker-compose.yml` on my machine because Docker isn't installed. The same setup, a single-node replica set, is what the tests run on.)

### 2. Start the API and the UI

```bash
# Terminal 1: API
cd server
npm install
cp .env.example .env     # then edit .env: MONGODB_URI, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
npm run dev              # http://localhost:3001

# Terminal 2: UI
cd client
npm install
npm run dev              # http://localhost:5173 (proxies /api to :3001)
```

Open http://localhost:5173 (it goes to `/submit-claim`, the public claim form) and use **Reviewer login** to sign in with the admin username and password you put in `.env`.

### Seeding

- **On startup**, if the `claims` collection is empty, the server loads 13 demo claims. Each one shows a scenario: a clean claim, an exact duplicate, a near duplicate, a missing receipt above and below the threshold, over-limit travel, a USD claim, the ambiguous "team dinner with Rahul", a future date and a date that's too old. If there are already claims, it skips seeding and logs that.
- **Also on startup**, it creates the admin account if it's missing, and logs whether it was created or already existed.
- **To start over:** `npm run seed -- --reset` drops the whole database (the only way to clear the append-only audit log) and loads the demo claims again. The admin is recreated on the next server start. The script refuses `--reset` when `NODE_ENV=production` unless `--force` is also given.

### Environment variables (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | *(required)* | Connection string. Must be a replica set (Atlas, or the local Docker setup). |
| `MONGODB_DB` | `expense_review` | Database name |
| `JWT_SECRET` | *(required in production)* | Signs session tokens. Use a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. In development, a missing secret is replaced by a random one for that run (logins then end on restart). |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | *(none)* | The admin account to create if it doesn't exist. Without them, nobody can log in. |
| `ANTHROPIC_API_KEY` | *(empty)* | Without it the app uses a deterministic **mock AI**, labelled as such in the UI and the logs. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model used for reviews |
| `AI_TIMEOUT_MS` | `30000` | Per-attempt AI timeout; one retry |
| `PORT` | `3001` | API port |
| `LOG_LEVEL` | `info` | pino log level |

`.env` is git-ignored and excluded from the Docker build. `.env.example` has placeholders only. Business rules (limits, exchange rates, thresholds) live in `server/src/config/config.json`, which is validated at startup.

### Production build (one process, one port)

```bash
cd client && npm run build
cd ../server && npm run build && npm start      # UI + API on :3001
```

## Tests

```bash
cd server && npm test           # 168 tests, LLM mocked, MongoDB in memory
cd server && npm run typecheck
cd client && npm run build      # type-checks and builds the UI
```

The tests start **one in-memory MongoDB replica set** (`mongodb-memory-server`) for the whole run, so transactions behave as they do in production. Each test gets its own fresh database. No local MongoDB or Docker is needed. The first run downloads a MongoDB binary, which can take a few minutes.

| Area | What is covered |
|---|---|
| Validators | Limit boundaries, invalid dates (2026-02-30, 2025-02-29), leap years, future and too-old dates, currency conversion, near-duplicate similarity |
| AI workflow | A valid answer, malformed JSON, retry then success, retry then failure, a timeout, an invented section, a quote not in its section, low confidence → uncertain, retrieval for sample descriptions |
| Database | Collections, indexes and validators are created and safe to re-run; validators refuse bad values even when the API is bypassed; a standalone server is refused; 15 parallel creates get claim numbers 1 to 15; a failed audit insert leaves nothing behind; the audit log has no update or delete path |
| API | The full review flow, duplicates through the API, reasons required (by the API and the database), no decisions on final claims, overrides leave the AI output untouched, the complete history, rollback of a decision when its audit write fails |
| Authentication | Login sets an httpOnly, sameSite=lax, 8-hour cookie; the same 401 for a wrong password and an unknown user; every protected route needs a login; public submission returns only a receipt; the decision actor is the session user even if the body names someone else; logout; tampered, expired, wrong-secret and `alg: none` tokens rejected; admin seeding never overwrites; production refuses a placeholder secret; no password, token or cookie in the logs |
| Pagination | Default page, custom limit, partial last page, a page past the end, filter with pagination, invalid values rejected, stable order with identical timestamps, the same number of queries for any page size |
| Seed | Each demo scenario triggers the flag it is meant to show; startup seeding only runs on an empty database |
| History formatter (client) | Every audit event type in plain language, failed AI runs, a null `before`, missing or wrongly-typed fields, unknown actions |

The client's pure history formatter is unit-tested by the server's vitest, so the client needs no test dependency of its own. The React screens have no automated tests yet. I checked them by driving a real headless Chrome through:
- the login redirect and the return to the page you wanted;
- a wrong password;
- pagination and the back button;
- the filter, the page size and a refresh;
- "Deciding as";
- an expired session;
- public submission;
- logout.

## Design decisions

- **The AI advises, code enforces, the human decides.**
  - The AI's verdict never changes a claim's status. Only a reviewer's decision does.
  - Rules that must always hold (limits, receipts, duplicates, dates) are plain code, not left to the model.
  - Going over a limit is a *warning* for the reviewer, never an automatic rejection.
- **The model's output is checked, not trusted.**
  - A structured-output JSON schema shapes the answer, and zod validates it again on the server: the API treats some schema limits only as hints, and the mock client never goes through the API.
  - Citations are checked against the policy text. An unverifiable one is shown as such and sends the claim to review.
  - The prompt treats the claim description as data, so instructions written into a claim are ignored.
- **No embeddings.** The policy is about 30 short clauses. BM25 keyword scoring with a small synonym list (for example "uber" → "taxi"), plus a boost for the claimed category, is fast, deterministic and easy to debug. It always adds clause 1.4 (unclear claims go to a reviewer), and the receipt clauses when there's no receipt.
- **MongoDB, used carefully.** I moved from SQLite to MongoDB so the app can run as a stateless service against a managed database (Atlas) instead of a file on one server's disk. To keep what SQLite gave me for free, I used:
  - transactions for every change and its audit event;
  - `$jsonSchema` validators in place of CHECK constraints;
  - an insert-only repository for the audit log;
  - a counter for readable claim numbers.
- **Sub-records use ObjectId strings.** Claims keep numeric ids (their claim number), but validation results, AI reviews, decisions and audit events are identified by ObjectId strings in the API.
- **Static exchange rates.** INR, USD, EUR and GBP rates in `config.json` are fixed demo values, not live rates. Amounts are converted to INR before any limit or receipt check.
- **Problems are stored, not refused.** The API rejects only input that can't be a claim at all (missing fields, wrong types). A future date or an unknown category is saved with an *error* flag, so the reviewer sees and handles it.
- **Approving over an error needs a reason.** Approving a claim that has an *error*-level flag (for example an exact duplicate) needs a written reason.

## Logging and errors

- **Structured JSON logs** (pino). Every request gets an `x-request-id`; a caller's ID is reused if it looks valid.
- **What gets logged:** each request's log lines include its `reqId`, plus `claimId`, `aiLatencyMs` and the AI status where they apply.
  - Login success and failure are logged with the username only.
  - Rejected requests are logged with their reason.
  - Request headers are left out, so cookies and tokens never reach the logs. A test checks the password, token and cookie name never appear.
- **Error responses** are always `{ "error": string, "details"?: … }`. Unexpected errors return a generic 500 that includes the request ID, so the matching log line can be found.

## Deployment

The app is one stateless container (UI and API on port 3001). All data lives in MongoDB, so I recommend **MongoDB Atlas** (the free tier is enough): it is a replica set, which the app needs for transactions, and it gives real persistence and backups without a disk to manage.

```bash
docker build -t expense-review .
docker run -p 3001:3001 \
  -e MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority" \
  -e JWT_SECRET="<long random string>" \
  -e ADMIN_USERNAME="<admin username>" -e ADMIN_PASSWORD="<admin password>" \
  -e ANTHROPIC_API_KEY="<optional>" \
  expense-review
```

> I have not built the image itself: Docker wasn't available on the development machine. I did replay the Dockerfile's steps on a clean copy of the repo and ran the result in production mode against MongoDB. It refused to start without `JWT_SECRET`, served the UI and API on one port, and set a `Secure` session cookie.

**Render / Railway:** deploy the Dockerfile as a web service, set the environment variables above in the host's settings (never in the repo), and use `/api/health` as the health check. It also pings MongoDB, so a lost database connection shows up as unhealthy. In Atlas, allow the host's outbound IPs under *Network Access*. For the audit log, give the app's database user a custom role without `update`/`remove` on `audit_events`.

## Limitations and next steps

**Claims are not tied to accounts.** Anyone can submit a claim, and "claimant" is just a name typed into the form. Only the reviewer side has accounts. That was deliberate, to keep submission frictionless for this prototype, but it means a claimant can't see their own claims, and nothing stops someone submitting under another person's name. Next I would:
- add login for claimants, using the existing `users` collection with roles `claimant`, `reviewer` and `admin`;
- let claimants see only their own claims, with `claimant` filled in from the session;
- let admins create reviewer accounts;
- add a separation-of-duties rule so a reviewer can never decide a claim they submitted, enforced in the API and covered by a test.

**One admin, no account management.** There is a single admin account, with no password reset, no way to add reviewers from the app, and no account lockout. Changing the password today means updating the stored hash in the database. Next: an admin page for reviewer accounts, password change and reset, and locking an account after repeated failed logins.

**No request throttling.** Nothing limits how fast someone can call the API. Next, I would add `express-rate-limit` with:
- a **strict** limit on `POST /api/auth/login` (for example a handful of attempts per minute per IP and username), to slow down password guessing;
- a **moderate** limit on the public `POST /api/claims`, to reduce spam submissions;
- an overall limit on the rest of the API.

If the app runs as several instances, the counters need a shared store such as Redis; otherwise each instance counts separately.

**Logout cannot revoke a token that was already copied.** Sessions are stateless JWTs, so logging out clears the cookie in the browser, but a token copied before that stays valid until it expires (at most 8 hours). Next: a short token lifetime with refresh, or a server-side session/deny-list collection.

**Other next steps:**
- **Cursor-based pagination.** `skip`/`limit` is simple and fine at this size, but slows down on very deep pages; paging by `(createdAt, claimNumber)` would fix that.
- **CSRF tokens.** I rely on `sameSite=lax` cookies plus JSON-only APIs today. If the cookie ever had to be `sameSite=none` (for example the UI on another domain), I would add CSRF tokens.
- **Database-level protection for the audit log.** Use a MongoDB role with insert/find but no update/remove on `audit_events` in every environment, not just as a recommendation.
- **A reply path for clarification.** A reviewer can request clarification, but the claimant can't answer in the app yet. They should be able to respond or correct the claim, which moves it back to *Under review*.
- **Notifications** by email or chat when clarification is requested or a decision is made.
- **AI quality is not measured.** Tests prove the workflow handles every kind of model output safely, but not how often the model is right. Next: a small labelled set of claims, scored for category accuracy, verdict agreement and citation validity whenever the prompt changes (`PROMPT_VERSION`). The live Claude call is also not covered by tests; every test uses a fake client.
- **Retrieval** relies on a hand-written synonym list, so unusual wording can miss a clause.
- **Lodging "per night"** limits are checked per claim, because the form has no nights field. The AI is asked to request the number of nights.
- **Duplicate detection** only compares claims from the same claimant on the same date.
- **Exchange rates** are static. Next: dated rates from a finance source.
- **No receipt files.** The form records only whether a receipt exists. Next: store the uploaded file for the reviewer to look at (reading it automatically is out of scope).
- **Frontend tests.** Only the history formatter is unit-tested; next would be component tests and an automated browser test of the review flow.
- **Development tooling advisories.** `npm audit --omit=dev` reports **no** advisories in the production server dependencies. The full `npm audit` reports advisories in the test and dev-server tooling:
  - vitest and its `tinypool` dependency (critical: prototype pollution in worker options);
  - the Vite 5 dev server and esbuild (high and moderate: path traversal and dev-server request issues).

  None of this code is in the production build or the Docker image. The fixed versions need Node 20.19+ or 22, so upgrading Node and then these packages is the first thing I'd do.

## How I used AI tools

I built this with **Claude Code** (Anthropic's coding agent) as a pair programmer, in two rounds.

- **The first version** (SQLite, no login): I wrote a brief that fixed the tech stack, the schema, the policy and config files, and a six-step plan with a stop after every step. Claude Code wrote each step, ran the tests, and reported the real output and the decisions it had made; I reviewed that before approving the next step.
- **The upgrade** (MongoDB, login, pagination, this README): I wrote a second brief with the decisions already made, such as the official MongoDB driver, a JWT in an httpOnly cookie, a single admin seeded from env, and no rate limiting yet. Again it worked in six phases, and I reviewed the test output and the list of changed files after each one before saying "continue".
- **Choices made during the build** that I can explain:
  - Verifying the model's output on our side, because the SDK's schema helper doesn't make the API enforce every constraint.
  - Using the claim-number counter's write conflict to keep duplicate detection correct under concurrency.
  - Checking unknown usernames against a dummy hash so login timing gives nothing away.
  - Keeping `/api/config` public because the public form needs it.
  - Proving "no query per claim" with MongoDB command monitoring instead of just claiming it.
- **Checking its work:**
  - Every test runs against a fake AI and an in-memory MongoDB replica set.
  - The real server was started and checked with curl at each phase.
  - The UI was driven in headless Chrome. These checks caught real issues, such as a layout bug on narrow screens, raw category keys shown in a message, and a typing bug in a helper, all fixed before moving on.
- **Responsible use:**
  - No secrets in the repository.
  - The admin password is set only through environment variables.
  - The app's own AI only advises, and its claims are checked against the policy text before a reviewer sees them.
