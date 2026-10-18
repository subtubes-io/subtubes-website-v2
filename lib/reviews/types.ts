import type { Generated } from "kysely";
import type { Manifest } from "./manifest";

export interface ReviewTable {
  id: string; organizationId: string; authorId: string | null; authorName: string;
  repoKey: string; repoRemoteUrl: string | null; sourceBranch: string; targetBranch: string;
  title: string; status: "open" | "closed" | "merged"; mergedAt: Date | null;
  latestRevisionId: string | null; cycle: string;
  createdAt: Generated<Date>; updatedAt: Generated<Date>;
}
export interface RevisionTable {
  id: string; reviewId: string; organizationId: string; number: number;
  state: "pending" | "complete" | "abandoned"; manifestHash: string; manifest: Manifest;
  expiresAt: Date; completedAt: Date | null; createdAt: Generated<Date>;
}
export interface ReviewBlobTable {
  organizationId: string; hash: string; byteSize: string; contentType: string;
  storagePath: string | null; verifiedAt: Date | null; createdAt: Generated<Date>;
}
export interface ParticipantTable {
  reviewId: string; organizationId: string; userId: string; memberId: string;
  lastSeenRevision: Generated<number>; addedAt: Generated<Date>;
}
export interface UploadTable {
  id: string; organizationId: string; revisionId: string; ownerId: string; hash: string;
  storagePath: string; expiresAt: Date; createdAt: Generated<Date>;
}
export interface ReviewSnapshot {
  id: string; organizationId: string; authorId: string | null; authorName: string;
  repoKey: string; repoRemoteUrl: string | null; sourceBranch: string; targetBranch: string;
  title: string; status: string; latestRevisionId: string | null; updatedAt: string;
  reviewerUserIds: string[];
}
