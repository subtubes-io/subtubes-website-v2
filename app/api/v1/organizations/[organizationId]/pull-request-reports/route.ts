import { handle, json } from "@/lib/pull-request-reports/errors";
import { authorize, readBody, requireIdempotencyKey, requireJson } from "@/lib/pull-request-reports/http";
import { listReports, parseListQuery, publishReport } from "@/lib/pull-request-reports/store";
import { validatePublishBody } from "@/lib/pull-request-reports/validate";

type Context = { params: Promise<{ organizationId: string }> };

export function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId } = await params;
    // Who and where are decided before the body is read, so a person who may not publish cannot make the website parse a 4 MB document.
    const caller = await authorize(request, organizationId);
    requireJson(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const validated = validatePublishBody(await readBody(request));
    const { created, report } = await publishReport({ organizationId, userId: caller.userId, idempotencyKey, validated });
    return json({ created, report }, created ? 201 : 200);
  });
}

export function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { organizationId } = await params;
    await authorize(request, organizationId);
    const query = parseListQuery(new URL(request.url).searchParams);
    return json(await listReports(organizationId, query));
  });
}
