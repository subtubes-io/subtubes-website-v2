import { handle, response, reviews } from "@/lib/reviews/http";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return handle(request, async (user) => response(await reviews.members(
    user, (await context.params).organizationId, new URL(request.url).searchParams,
  )));
}
