import { handle, readJson, response, reviews } from "@/lib/reviews/http";

type Context = { params: Promise<{ reviewId: string }> };
export async function GET(request: Request, context: Context) {
  return handle(request, async (user) => response(await reviews.get(user, (await context.params).reviewId)));
}
export async function PATCH(request: Request, context: Context) {
  return handle(request, async (user) => response(await reviews.patch(user, (await context.params).reviewId, await readJson(request))));
}
export async function DELETE(request: Request, context: Context) {
  return handle(request, async (user) => response(await reviews.remove(user, (await context.params).reviewId), 202));
}
