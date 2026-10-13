import { authenticateOrgMember, errorResponse } from "./common";
import { DesignError } from "./designs";

export async function designRequest(
  request: Request, orgId: string, operation: (userId: string) => Promise<Response>,
): Promise<Response> {
  try {
    const auth = await authenticateOrgMember(request, orgId);
    if (auth.error) return auth.error;
    return await operation(auth.user.id);
  } catch (error) {
    if (error instanceof DesignError) {
      return errorResponse(error.status, error.code, error.message, error.details);
    }
    console.error("Design API operation failed", error);
    return errorResponse(500, "internal_error", "Could not complete the design operation. Retry safely using the same upload ID.");
  }
}

export function designPage(request: Request, numericCursor = false) {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const cursor = params.get("cursor");
  if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100) {
    throw new DesignError(422, "invalid_page", "limit must be an integer from 1 to 100.");
  }
  if (cursor !== null && (
    !cursor || cursor.length > 200 ||
    (numericCursor && (!/^[1-9]\d*$/.test(cursor) || Number(cursor) > 2_147_483_647))
  )) {
    throw new DesignError(422, "invalid_page", "Invalid pagination cursor.");
  }
  return { limit: Number(rawLimit), cursor };
}
