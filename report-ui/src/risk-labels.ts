import type { SensitiveChange, TestWeakening } from "./model/types";

export const EXPOSURE: Record<SensitiveChange["exposure"], string> = {
  "entry-point": "Is an entry point",
  reachable: "Reachable from an entry point",
  unreached: "No entry point imports it",
  "not-analyzed": "Not in import graph",
};
export const WEAKENED: Record<TestWeakening["kind"], string> = {
  "deleted-test-file": "Deleted test file",
  "skipped-or-focused": "Skipped or focused test",
  "fewer-assertions": "Fewer assertions",
};
