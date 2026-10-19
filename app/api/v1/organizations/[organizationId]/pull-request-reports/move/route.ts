import { handle, json } from "@/lib/pull-request-reports/errors";
import { authorize, canManage, readBody, requireJson } from "@/lib/pull-request-reports/http";
import { moveReports } from "@/lib/pull-request-reports/store";
import { validateMoveBody } from "@/lib/pull-request-reports/validate";

// The project's remote changed: file its reports under the new repository.
export function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handle(async () => {
    const { organizationId } = await params;
    const caller = await authorize(request, organizationId);
    requireJson(request);
    const move = validateMoveBody(await readBody(request));
    return json(await moveReports(organizationId, move, { userId: caller.userId, canManage: canManage(caller) }));
  });
}
