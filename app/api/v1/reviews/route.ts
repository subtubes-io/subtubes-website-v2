import { handle, response, reviews } from "@/lib/reviews/http";

export async function GET(request: Request) {
  return handle(request, async (user) => response(await reviews.list(user, new URL(request.url).searchParams)));
}
