import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import {
  DesignError, parseUpload, readDesignBody, saveDesignVersion, versionSummary,
} from "@/lib/cloud-push/designs";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { db } from "@/lib/db/client";

type Context = { params: Promise<{ orgId: string; designId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const upload = parseUpload(await readDesignBody(request));
    const result = await saveDesignVersion(db, orgId, designId, userId, upload, readerCapabilities(request, "design"));
    return jsonResponse({ success: true, ...result }, result.replayed ? 200 : 201);
  });
}

export async function GET(request: Request, { params }: Context) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async () => {
    const { limit, cursor } = designPage(request, true);
    const reader = readerCapabilities(request, "design");
    const design = await db.selectFrom("design").select(["id", "preferredVersionId", "headGeneration"])
      .where("id", "=", designId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!design) throw new DesignError(404, "not_found", "Design not found.");
    let query = db.selectFrom("designVersion")
      .innerJoin("design", (join) => join
        .onRef("design.id", "=", "designVersion.designId")
        .onRef("design.organizationId", "=", "designVersion.organizationId"))
      .selectAll("designVersion").select(["design.preferredVersionId", "design.headGeneration"])
      .where("design.id", "=", designId).where("design.organizationId", "=", orgId)
      .orderBy("designVersion.number", "desc").limit(limit + 1);
    if (cursor) query = query.where("designVersion.number", "<", Number(cursor));
    const rows = await query.execute();
    const versions = rows.slice(0, limit).map((version) => ({
      ...versionSummary(version, reader), preferred: version.id === version.preferredVersionId,
    }));
    return jsonResponse({
      success: true, designId, versions,
      preferredVersionId: rows[0]?.preferredVersionId ?? design.preferredVersionId,
      headGeneration: rows[0]?.headGeneration ?? design.headGeneration,
      nextCursor: rows.length > limit ? String(versions[versions.length - 1].number) : null,
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
