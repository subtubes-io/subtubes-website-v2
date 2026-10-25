"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
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
    // Everything is shown at full strength until the first play; then the player fades what a step does not touch.
    created.getState().setFocusMode(false);
    const unsubscribe = created.subscribe((state) => {
      if (state.runId === 0) return;
      unsubscribe();
      state.setFocusMode(true);
    });
    return created;
  }, [diagram, design.scenarios]);
  const [highlights, setHighlights] = useState<Highlights | undefined>();
  const focus = useStore(store, (state) => state.focusMode);

  useEffect(() => {
    const show = (state: ReturnType<typeof store.getState>) =>
      setHighlights(state.trace ? highlightsAt(state.trace, state.cursor) : undefined);
    show(store.getState());
    return store.subscribe(show);
  }, [store]);

  return (
    <div className="challenge-design">
      <section aria-label={`Diagram: ${diagram.name}`}>
        <div className="challenge-diagram">
          <DiagramViewer config={{ diagram, highlights, focus }} />
        </div>
      </section>
      <section aria-label="Scenarios">
        <SimulationContext.Provider value={store}>
          <ScenarioPlayer config={{ closable: false }} />
        </SimulationContext.Provider>
      </section>
    </div>
  );
}
