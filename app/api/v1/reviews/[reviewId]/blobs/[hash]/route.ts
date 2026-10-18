import { handle, reviews } from "@/lib/reviews/http";

export async function GET(request: Request, context: { params: Promise<{ reviewId: string; hash: string }> }) {
  return handle(request, async (user) => {
    const params = await context.params;
    return new Response(null, { status: 307, headers: {
      Location: await reviews.download(user, params.reviewId, params.hash), "Cache-Control": "no-store",
    } });
  }, "download");
}
