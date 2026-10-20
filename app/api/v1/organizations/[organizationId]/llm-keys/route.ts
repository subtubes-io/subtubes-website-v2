import { ApiError, handle, json } from "@/lib/pull-request-reports/errors";
import { authorize, canManage } from "@/lib/pull-request-reports/http";
import { countActiveKeys, createApiKey, listApiKeys, MAX_KEYS_PER_MEMBER, normalizeLabel } from "@/lib/llm/keys";
import { getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

type Context = { params: Promise<{ organizationId: string }> };

// The desktop app (bearer session) mints an LLM API key for the signed-in person in an organization, and lists their keys. The key is
// only in the POST response; use it as the OpenAI API key with base URL /api/llm/v1.
export function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId } = await params;
    const caller = await authorize(request, organizationId);
    let label: string | null = "Desktop app";
    if (request.headers.get("content-length") !== "0" && request.body) {
      const text = await request.text();
      if (text.length > 4096) throw new ApiError("payload-too-large", "The request is too large.");
      if (text.trim()) {
        try {
          label = normalizeLabel((JSON.parse(text) as { label?: unknown }).label ?? "Desktop app");
        } catch {
          throw new ApiError("bad-request", "The body must be JSON.");
        }
      }
    }
    if (!label) throw new ApiError("bad-request", "The label must be 1 to 80 characters.");
    const limit = await getRateLimiter().hit(`user:${caller.userId}:llm-key`, RATE_LIMITS.llmKeyCreation());
    if (!limit.allowed) throw new ApiError("rate-limited", "Too many keys created. Try again later.", { retryAfterSeconds: limit.retryAfterSeconds });
    if (await countActiveKeys(caller.userId, organizationId) >= MAX_KEYS_PER_MEMBER) {
      throw new ApiError("bad-request", `You have ${MAX_KEYS_PER_MEMBER} keys in this organization. Revoke one first.`);
    }
    return json(await createApiKey({ userId: caller.userId, organizationId, label }), 201);
  });
}

export function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId } = await params;
    const caller = await authorize(request, organizationId);
    return json({ keys: await listApiKeys(organizationId, caller.userId, canManage(caller)) });
  });
}
