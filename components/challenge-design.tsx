"use client";

import { useEffect, useMemo, useState } from "react";
import { DiagramViewer } from "@subtubes/diagram-react";
import "@subtubes/diagram-react/diagram.css";
import { ScenarioPlayer, SimulationContext, createSimulationStore } from "@subtubes/scenario-react";
import "@subtubes/scenario-react/scenario.css";
import { parseDiagram, type Highlights } from "@subtubes/diagram-core";
import { highlightsAt, type Scenario } from "@subtubes/scenario-core";

// A design's diagram with its scenario player underneath. Playing a scenario lights up the path it takes on the diagram.
export function ChallengeDesign({ design }: { design: { diagram: unknown; scenarios: Scenario[] } }) {
  const diagram = useMemo(() => parseDiagram(design.diagram), [design.diagram]);
  const store = useMemo(() => {
    const created = createSimulationStore(() => ({ nodes: diagram.nodes, edges: diagram.edges }));
    created.getState().registerScenarios(design.scenarios);
    created.getState().openPanel();
    return created;
  }, [diagram, design.scenarios]);
  const [highlights, setHighlights] = useState<Highlights | undefined>();

  useEffect(() => {
    const show = (state: ReturnType<typeof store.getState>) =>
      setHighlights(state.trace ? highlightsAt(state.trace, state.cursor) : undefined);
    show(store.getState());
    return store.subscribe(show);
  }, [store]);

  return (
    <div className="challenge-design">
      <section aria-label={`Diagram: ${diagram.name}`}>
        <h2 className="dashboard-section-title">Diagram</h2>
        <div className="challenge-diagram">
          <DiagramViewer config={{ diagram, highlights, focus: true }} />
        </div>
      </section>
      <section aria-label="Scenarios">
        <h2 className="dashboard-section-title">Scenario</h2>
        <SimulationContext.Provider value={store}>
          <ScenarioPlayer />
        </SimulationContext.Provider>
      </section>
    </div>
  );
}
