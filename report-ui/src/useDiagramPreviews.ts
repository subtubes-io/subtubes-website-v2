"use client";
import { useEffect, useRef, useState } from "react";
import type { ReportSwimlane } from "./model/report-swimlanes";
import { uploadImage } from "./attachments";
import { designPng } from "./design-image";
import { reportServices } from "./services";
import type { ReportScope } from "./report-scope";

/** Gives every diagram in the open report a PNG picture to show as its preview, making and saving the ones that have none yet. A failure leaves the card without a picture. */
export function useDiagramPreviews(scope: ReportScope | undefined, diagrams: ReportSwimlane[], enabled: boolean) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!scope || !enabled) return;
    const missing = diagrams.filter((diagram) => !diagram.preview && !previews[diagram.id] && !tried.current.has(diagram.id));
    if (!missing.length) return;
    let current = true;
    void (async () => {
      for (const diagram of missing) {
        tried.current.add(diagram.id);
        try {
          const { hash } = await uploadImage(await designPng(diagram.content));
          await reportServices.reportDesigns({ action: "preview", ...scope, diagramId: diagram.id, image: hash });
          if (current) setPreviews((old) => ({ ...old, [diagram.id]: hash }));
        } catch (error) { console.warn("Unable to make a diagram preview", error); }
      }
    })();
    return () => { current = false; };
  }, [scope?.projectId, scope?.reportId, diagrams, enabled, previews]);
  return previews;
}
