import { handle, response, reviews } from "@/lib/reviews/http";
import { revisionNumber } from "@/lib/reviews/service";

export async function GET(request: Request, context: { params: Promise<{ reviewId: string; revisionNumber: string }> }) {
  return handle(request, async (user) => {
    const params = await context.params;
    return response(await reviews.get(user, params.reviewId, revisionNumber(params.revisionNumber)));
  });
}
