import {
  authenticateOrgMember,
  corsPreflightResponse,
  jsonResponse,
} from "@/lib/cloud-push/common";
import { db } from "@/lib/db/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const reports = await db
    .selectFrom("report")
    .select([
      "id",
      "projectName",
      "schemaVersion",
      "revision",
      "contentHash",
      "report",
      "createdAt",
      "updatedAt",
    ])
    .where("organizationId", "=", orgId)
    .orderBy("updatedAt", "desc")
    .execute();

  const snapshots = await db
    .selectFrom("reportSnapshot")
    .select([
      "id",
      "reportId",
      "number",
      "takenAt",
      "note",
      "commit",
      "schemaVersion",
      "contentHash",
    ])
    .where("organizationId", "=", orgId)
    .orderBy("number", "asc")
    .execute();

  const snapshotsByReport = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = snapshotsByReport.get(s.reportId) ?? [];
    list.push(s);
    snapshotsByReport.set(s.reportId, list);
  }

  const items = reports.map((r) => {
    let reportData: any = {};
    try {
      reportData = JSON.parse(r.report);
    } catch {
      reportData = {};
    }

    const reportSnaps = snapshotsByReport.get(r.id) ?? [];
    const latestSnap = reportSnaps[reportSnaps.length - 1];
    let latestCommit: any = null;
    if (latestSnap?.commit) {
      try {
        latestCommit = JSON.parse(latestSnap.commit);
      } catch {
        latestCommit = null;
      }
    }

    const flags = Array.isArray(reportData.flags) ? reportData.flags : [];
    const flagCounts = {
      high: flags.filter((f: any) => f.severity === "high").length,
      medium: flags.filter((f: any) => f.severity === "medium").length,
      low: flags.filter((f: any) => f.severity === "low").length,
    };

    return {
      id: r.id,
      name: reportData.title || r.projectName || r.id,
      projectName: r.projectName,
      title: reportData.title,
      savedAt: r.updatedAt.toISOString(),
      stats: reportData.stats ?? { files: 0, additions: 0, deletions: 0 },
      snapshots: {
        count: reportSnaps.length,
        latest: latestSnap
          ? {
              number: latestSnap.number,
              takenAt: latestSnap.takenAt.toISOString(),
              commit: latestCommit,
            }
          : undefined,
      },
      info: {
        preview: reportData.narrative?.slice(0, 200) || "",
        flags: flagCounts,
        shots: Object.keys(reportData.shots ?? {}).length,
        visualScenarios: reportData.visual?.scenarios?.length ?? 0,
        mapNodes: reportData.map?.nodes?.length ?? 0,
        flows: reportData.result?.flows?.length ?? 0,
        base: reportData.base,
        head: reportData.head,
      },
    };
  });

  return jsonResponse({
    success: true,
    reports: items,
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
