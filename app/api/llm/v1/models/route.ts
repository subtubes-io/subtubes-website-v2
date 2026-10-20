import { getAccount } from "@/lib/llm/account";
import { authenticateLlm } from "@/lib/llm/auth";
import { handleLlm, NO_STORE } from "@/lib/llm/errors";
import { enabledModelIds, LLM_MODELS } from "@/lib/llm/models";

// The catalog models the key's organization has enabled, in OpenAI's list shape plus what a model picker needs.
export function GET(request: Request) {
  return handleLlm(async () => {
    const caller = await authenticateLlm(request);
    const enabled = enabledModelIds((await getAccount(caller.organizationId))?.enabledModels);
    const data = LLM_MODELS.filter((m) => enabled.includes(m.id)).map((m) => ({
      id: m.id,
      object: "model",
      created: 0,
      owned_by: m.provider,
      name: m.label,
      context_length: m.contextLength,
      max_output_tokens: m.maxOutputTokens,
      supports_tools: m.supportsTools,
      supports_images: m.supportsImages,
      pricing: { input_per_million_usd: m.pricing.input, cached_input_per_million_usd: m.pricing.cachedInput, output_per_million_usd: m.pricing.output },
    }));
    return Response.json({ object: "list", data }, { headers: NO_STORE });
  });
}
