"use client";
import type { DesignRef } from "./model/types";
import "./report-content.css";

export function DesignRefs({ config }: { config: { refs: DesignRef[]; onOpenDesign?: (ref: DesignRef) => void } }) {
  return <section className="summary-section summary-designs" aria-label="Related designs">
    <h3>Related designs ({config.refs.length})</h3>
    <p className="loc">Opens the current diagram in a new tab.</p>
    <ul>{config.refs.map((ref) => <li key={JSON.stringify([ref.designId, ref.nodeId])}>
      <button type="button" className="report-design-link" title="Open diagram in new tab" disabled={!config.onOpenDesign} onClick={() => config.onOpenDesign?.(ref)}>
        {ref.label ?? ref.designId}{ref.nodeId && <small> · Node: {ref.nodeId}</small>}
      </button>
      {!config.onOpenDesign && <span className="loc">Design navigation is unavailable.</span>}
    </li>)}</ul>
  </section>;
}
