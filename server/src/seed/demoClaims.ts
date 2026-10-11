import { createClaim } from "../claims/createClaim";
import { addDays } from "../clock";
import type { AppConfig } from "../config/config";
import type { Store } from "../db/mongo";
import { countClaims } from "../db/repository";
import type { ClaimInput } from "../validators";

// Realistic demo claims. Each one exercises a specific path through the
// validators or the AI review (noted in `scenario`). Dates are relative to
// today so the old/future/duplicate cases keep working whenever the demo runs.

export interface DemoClaim {
  scenario: string;
  claim: ClaimInput;
}

export function demoClaims(today: string): DemoClaim[] {
  const d = (offset: number) => addDays(today, offset);
  return [
    {
      scenario: "clean claim that should comply",
      claim: { claimant: "Asha Rao", date: d(-8), category: "meals", amount: 1200, currency: "INR", description: "Dinner during Pune site visit for the warehouse rollout", receiptAvailable: true },
    },
    {
      scenario: "exact duplicate of the claim above",
      claim: { claimant: "Asha Rao", date: d(-8), category: "meals", amount: 1200, currency: "INR", description: "Dinner in Pune, warehouse rollout visit", receiptAvailable: true },
    },
    {
      scenario: "original for the near duplicate",
      claim: { claimant: "Vikram Shah", date: d(-6), category: "travel_transport", amount: 850, currency: "INR", description: "Taxi from airport to hotel in Bengaluru", receiptAvailable: true },
    },
    {
      scenario: "near duplicate (same day, similar description, different amount)",
      claim: { claimant: "Vikram Shah", date: d(-6), category: "travel_transport", amount: 900, currency: "INR", description: "Taxi from airport to the hotel in Bengaluru", receiptAvailable: true },
    },
    {
      scenario: "missing receipt above the threshold",
      claim: { claimant: "Neha Iyer", date: d(-4), category: "office_supplies", amount: 1800, currency: "INR", description: "Printer cartridges for the Chennai office", receiptAvailable: false },
    },
    {
      scenario: "missing receipt below the threshold",
      claim: { claimant: "Neha Iyer", date: d(-3), category: "travel_transport", amount: 350, currency: "INR", description: "Auto rickshaw to a client meeting in T. Nagar", receiptAvailable: false },
    },
    {
      scenario: "over-limit travel",
      claim: { claimant: "Rohan Mehta", date: d(-10), category: "travel_transport", amount: 4200, currency: "INR", description: "Cab hired for a full day of client visits around Mumbai", receiptAvailable: true },
    },
    {
      scenario: "USD claim converted to INR",
      claim: { claimant: "Priya Nair", date: d(-12), category: "training", amount: 120, currency: "USD", description: "Online course on React performance for the dashboard project", receiptAvailable: true },
    },
    {
      scenario: "ambiguous: meals or client entertainment? (also over the meals limit)",
      claim: { claimant: "Asha Rao", date: d(-2), category: "meals", amount: 2400, currency: "INR", description: "team dinner with Rahul after the offsite", receiptAvailable: true },
    },
    {
      scenario: "client entertainment with client name and purpose",
      claim: { claimant: "Priya Nair", date: d(-7), category: "client_entertainment", amount: 5200, currency: "INR", description: "Lunch with the Acme Retail procurement team to discuss the contract renewal", receiptAvailable: true },
    },
    {
      scenario: "lodging missing nights and city (AI should ask), over the per-night limit",
      claim: { claimant: "Rohan Mehta", date: d(-5), category: "lodging", amount: 14000, currency: "INR", description: "Hotel stay for the vendor audit", receiptAvailable: true },
    },
    {
      scenario: "future date",
      claim: { claimant: "Karan Gupta", date: d(10), category: "lodging", amount: 6500, currency: "INR", description: "Hotel in Hyderabad, 1 night, for the vendor audit", receiptAvailable: true },
    },
    {
      scenario: "too old (beyond the submission window)",
      claim: { claimant: "Meera Joshi", date: d(-120), category: "software", amount: 3000, currency: "INR", description: "Figma annual subscription for UI design work", receiptAvailable: true },
    },
  ];
}

// One at a time, in order, so claim numbers match the list above and the
// duplicate scenarios see the claims they duplicate.
export async function seedDemoClaims(store: Store, config: AppConfig, today: string): Promise<{ id: number; scenario: string }[]> {
  const seeded: { id: number; scenario: string }[] = [];
  for (const { scenario, claim } of demoClaims(today)) {
    seeded.push({ id: await createClaim(store, config, claim, today), scenario });
  }
  return seeded;
}

// Used at server startup: seed only an empty database, never add demo data on
// top of real claims. Returns how many claims were seeded (0 = skipped).
export async function seedIfEmpty(store: Store, config: AppConfig, today: string): Promise<number> {
  if ((await countClaims(store.db)) > 0) return 0;
  return (await seedDemoClaims(store, config, today)).length;
}
