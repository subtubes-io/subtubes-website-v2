import { handle, json, NO_STORE } from "@/lib/pull-request-reports/errors";
import { authorize, canManage } from "@/lib/pull-request-reports/http";
import { deleteReport, readReport } from "@/lib/pull-request-reports/store";

type Context = { params: Promise<{ organizationId: string; reportId: string }> };

export function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId, reportId } = await params;
    await authorize(request, organizationId);
    return json(await readReport(organizationId, reportId));
  });
}

export function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId, reportId } = await params;
    const caller = await authorize(request, organizationId);
    await deleteReport(organizationId, reportId, { userId: caller.userId, canManage: canManage(caller) });
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
