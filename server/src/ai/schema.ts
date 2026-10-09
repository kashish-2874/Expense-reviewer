// The SDK's structured-output helper (zodOutputFormat) is built on the zod v4
// API, which the installed zod 3.25 package ships under "zod/v4". Only this file
// uses it; the rest of the app uses the regular "zod" import.
import { z } from "zod/v4";

export const VERDICTS = ["comply", "needs_clarification", "needs_review"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const UNCLEAR = "unclear";

// The JSON the model must return. The same schema constrains the API response
// and re-validates the text afterwards, because mock and test clients bypass the API.
export function makeAiOutputSchema(categoryKeys: string[]) {
  return z.object({
    category: z.enum([UNCLEAR, ...categoryKeys]),
    confidence: z.number().min(0).max(1),
    verdict: z.enum(VERDICTS),
    explanation: z.string().min(1),
    cited_sections: z.array(z.object({ section: z.string(), quote: z.string() })),
    questions_for_claimant: z.array(z.string()),
  });
}

export type AiOutput = z.infer<ReturnType<typeof makeAiOutputSchema>>;
