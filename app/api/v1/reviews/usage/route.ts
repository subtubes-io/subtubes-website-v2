import { handle, response, reviews } from "@/lib/reviews/http";
import { ReviewError } from "@/lib/reviews/errors";

export async function GET(request: Request) {
  return handle(request, async (user) => {
    const org = new URL(request.url).searchParams.get("organizationId");
    if (!org) throw new ReviewError(400, "invalid_request", "organizationId is required.");
    return response(await reviews.usage(user, org));
  });
}
