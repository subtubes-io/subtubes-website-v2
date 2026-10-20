import { connection } from "next/server";
import { LlmError, llmErrorResponse } from "@/lib/llm/errors";

async function notFound() {
  await connection();
  return llmErrorResponse(new LlmError("invalid_request", "No such endpoint. See docs/llm-api.md."), {}, 404);
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH,
  notFound as DELETE, notFound as OPTIONS, notFound as HEAD };
