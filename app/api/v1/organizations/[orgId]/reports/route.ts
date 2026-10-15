import { z } from "zod";
import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import { readerCapabilities, validateStored } from "@/lib/cloud-push/document-compatibility";
import { reportCompatibility, reportDocument } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

const summarySchema = z.looseObject({
  title: z.string().optional(), narrative: z.string().optional(),
  stats: z.looseObject({}).optional(),
  flags: z.array(z.looseObject({ severity: z.string().optional() })).optional(),
  shots: z.record(z.string(), z.unknown()).optional(),
  visual: z.looseObject({ scenarios: z.array(z.unknown()).optional() }).optional(),
  map: z.looseObject({ nodes: z.array(z.unknown()).optional() }).optional(),
  result: z.looseObject({ flows: z.array(z.unknown()).optional() }).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return designRequest(request, orgId, async () => {
    const reader = readerCapabilities(request, "report");
    const { limit, cursor } = designPage(request);
    let query = db.selectFrom("report").selectAll().where("organizationId", "=", orgId);
    if (reader.explicit) {
      query = query.orderBy("id", "asc").limit(limit + 1);
      if (cursor) query = query.where("id", ">", cursor);
    } else {
      query = query.orderBy("updatedAt", "desc");
    }
    const rows = await query.execute();
    const page = reader.explicit ? rows.slice(0, limit) : rows;
    const reports = page.map((row) => {
      const state = reportCompatibility(row, reader);
      const metadata = {
        id: row.id, name: row.projectName, projectName: row.projectName,
        ...(reader.explicit ? { schemaVersion: row.schemaVersion, revision: row.revision, contentHash: row.contentHash } : {}),
        savedAt: row.updatedAt.toISOString(),
        ...(reader.explicit || state.status === "invalid" ? { compatibility: state } : {}),
      };
      if (reader.explicit || state.status !== "supported") return metadata;
      const content = validateStored(summarySchema, reportDocument(row, reader), row.id);
      const flags = content.flags ?? [];
      return {
        ...metadata, name: content.title ?? row.projectName, title: content.title,
        stats: content.stats ?? { files: 0, additions: 0, deletions: 0 },
        info: {
          preview: content.narrative?.slice(0, 200) ?? "",
          flags: {
            high: flags.filter((flag) => flag.severity === "high").length,
            medium: flags.filter((flag) => flag.severity === "medium").length,
            low: flags.filter((flag) => flag.severity === "low").length,
          },
          shots: Object.keys(content.shots ?? {}).length, visualScenarios: content.visual?.scenarios?.length ?? 0,
          mapNodes: content.map?.nodes?.length ?? 0, flows: content.result?.flows?.length ?? 0,
          base: content.base, head: content.head,
        },
      };
    });
    return jsonResponse({
      success: true, reports,
      ...(reader.explicit ? { nextCursor: rows.length > limit ? page.at(-1)!.id : null } : {}),
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
