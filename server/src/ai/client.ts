import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Logger } from "../logger";
import type { ClaimInput } from "../validators";
import type { PolicySection } from "./policy";
import type { Prompt } from "./prompt";
import { makeAiOutputSchema } from "./schema";

// The review workflow only depends on this interface, so tests inject a fake
// client and the app can run a labelled mock when no API key is configured.
export interface AiRequest {
  prompt: Prompt;
  claim: ClaimInput;
  sections: PolicySection[];
  categoryKeys: string[];
}

export interface AiClient {
  readonly model: string;
  readonly isMock: boolean;
  // Returns the model's raw text. Parsing and validation happen in review.ts.
  complete(request: AiRequest, signal: AbortSignal): Promise<string>;
}

export class AnthropicAiClient implements AiClient {
  readonly isMock = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // maxRetries 0: review.ts owns the single retry, so attempts stay predictable
    // and every one of them is logged.
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(request: AiRequest, signal: AbortSignal): Promise<string> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 4000,
        system: request.prompt.system,
        messages: [{ role: "user", content: request.prompt.user }],
        output_config: {
          // Classification against a short policy does not need deep reasoning;
          // medium keeps latency well inside the timeout.
          effort: "medium",
          format: zodOutputFormat(makeAiOutputSchema(request.categoryKeys)),
        },
      },
      { signal },
    );

    if (response.stop_reason === "refusal") {
      throw new Error("Model declined to review this claim");
    }
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text === "") throw new Error(`Model returned no text (stop_reason: ${response.stop_reason})`);
    return text;
  }
}

// Deterministic stand-in used when ANTHROPIC_API_KEY is not set, so the app can
// be demoed end to end. Its output is clearly labelled and always marked uncertain.
export class MockAiClient implements AiClient {
  readonly model = "mock-ai (no API key configured)";
  readonly isMock = true;

  async complete(request: AiRequest): Promise<string> {
    const evidence = request.sections[0];
    return JSON.stringify({
      category: request.categoryKeys.includes(request.claim.category) ? request.claim.category : "unclear",
      confidence: 0.5,
      verdict: "needs_review",
      explanation:
        "[MOCK AI] No Anthropic API key is configured, so this is a placeholder result, not a real policy analysis. " +
        "The claimed category was echoed back. Please review this claim manually.",
      cited_sections: evidence ? [{ section: evidence.id, quote: evidence.text }] : [],
      questions_for_claimant: [],
    });
  }
}

export function createAiClient(apiKey: string | undefined, model: string, logger: Logger): AiClient {
  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY is not set: using the MOCK AI client. AI findings are placeholders.");
    return new MockAiClient();
  }
  return new AnthropicAiClient(apiKey, model);
}
