import { handle, readJson, response, reviews } from "@/lib/reviews/http";

export async function PUT(request: Request, context: { params: Promise<{ reviewId: string }> }) {
  return handle(request, async (user) => response(await reviews.seen(user, (await context.params).reviewId, await readJson(request))));
}
