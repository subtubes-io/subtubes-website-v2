"use client";
import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import type { DesignNodeStatus } from "./model/designs";

export const STATUS_LABEL: Record<DesignNodeStatus, string> = { "in-progress": "In progress", completed: "Completed" };

/** Header icon for a node's implementation status; nodes without a status render nothing. */
export function NodeStatusIcon({ status, size = 16 }: { status?: DesignNodeStatus; size?: number }) {
  if (!status) return null;
  const Icon = status === "completed" ? CircleCheck : LoaderCircle;
  return <Icon className={`design-node-status ${status}`} size={size} role="img" aria-label={`Status: ${STATUS_LABEL[status]}`} />;
}

export { Circle as NoStatusIcon, CircleCheck as CompletedIcon, LoaderCircle as InProgressIcon };
