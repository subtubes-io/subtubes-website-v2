import { configureReportServices } from "@subtubes/report-ui";

let initialized = false;

export function ensureReportServicesConfigured() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  configureReportServices({
    attachmentBytes: async (hash: string) => {
      const response = await fetch(`/api/blobs/${encodeURIComponent(hash)}`);
      if (!response.ok) {
        throw new Error(`Failed to load attachment ${hash}: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    },
  });
}
