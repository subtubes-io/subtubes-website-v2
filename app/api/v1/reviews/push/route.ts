import { handle, readJson, response, reviews } from "@/lib/reviews/http";

export async function POST(request: Request) {
  return handle(request, async (user) => {
    const result = await reviews.push(user, await readJson(request));
    return response(result.body, result.created ? 201 : 200);
  }, "push");
}
