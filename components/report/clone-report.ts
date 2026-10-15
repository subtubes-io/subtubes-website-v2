/** Asks the website to make an independent copy of a report in the same organization. */
export async function cloneReportRequest(slug: string, reportId: string): Promise<{ reportId: string; name: string }> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(slug)}/reports/${encodeURIComponent(reportId)}/clone`,
    { method: "POST" },
  );
  const body = await response.json().catch(() => undefined) as
    { reportId?: string; name?: string; error?: { message?: string } } | undefined;
  if (!response.ok || !body?.reportId) {
    throw new Error(body?.error?.message ?? `Could not clone the report (${response.status}).`);
  }
  return { reportId: body.reportId, name: body.name ?? "" };
}
