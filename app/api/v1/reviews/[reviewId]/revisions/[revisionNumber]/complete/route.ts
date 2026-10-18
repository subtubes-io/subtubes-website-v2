import { handle, response, reviews } from "@/lib/reviews/http";
import { revisionNumber } from "@/lib/reviews/service";

export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ reviewId: string; revisionNumber: string }> }) {
  return handle(request, async (user) => {
    const params = await context.params;
    const result = await reviews.complete(user, params.reviewId, revisionNumber(params.revisionNumber));
    return response(result, result.verifying ? 202 : 200);
  }, "complete");
}
