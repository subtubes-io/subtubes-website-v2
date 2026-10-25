# Known issues

None open.

## Resolved

### The highlight types were declared twice

The canvas and the scenario player each declared `NodeHighlight`, `EdgeHighlight` and `Highlights`, identical but separate, because neither may import the other (the canvas may not import the app, and the simulation is kept independent of the diagram). A change to one would not have shown in the other.

**Fixed.** They are declared once, in `@subtubes/diagram-core` ([`highlights.ts`](../../diagram-core/src/highlights.ts)), which both depend on already: the canvas draws them, `src/simulation/highlights.ts` produces them (`highlightsAt`), and neither imports the other. The kinds are also exported as values (`NODE_HIGHLIGHTS`, `EDGE_HIGHLIGHTS`), so two tests can hold them to the rest of the system:

- `packages/diagram-react/src/theme.test.ts`: the canvas's CSS has a `.node.hl-*` or `.edge.hl-*` rule for every kind.
- `src/simulation/highlights.test.ts`: the player only produces kinds in those lists.

**To add a highlight kind:** add it to `NODE_HIGHLIGHTS` or `EDGE_HIGHLIGHTS` in `highlights.ts`, give it a rule in `packages/diagram-react/src/diagram.css`, and have the producer set it. A kind with no style fails the first test.
