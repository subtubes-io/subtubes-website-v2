import type { Generated } from "kysely";
import type { ProfileLinks } from "@/lib/profile-links";
import type { ParticipantTable, ReviewBlobTable, ReviewTable, RevisionTable, UploadTable } from "@/lib/reviews/types";

export interface Database {
  review: ReviewTable;
  reviewReport: {
    id: string; organizationId: string; revisionId: string; ownerId: string | null;
    ownerName: string; clientId: string; kind: "commit" | "range"; title: string;
    envelope: import("@/lib/reviews/manifest").Manifest["reports"][number]; createdAt: Generated<Date>;
  };
  reviewRevision: RevisionTable;
  reviewBlob: ReviewBlobTable;
  reviewParticipant: ParticipantTable;
  reviewUpload: UploadTable;
  reviewRevisionBlob: { revisionId: string; organizationId: string; hash: string };
  reviewClock: { id: boolean; value: string };
  reviewChange: { seq: string; organizationId: string; reviewId: string; before: import("@/lib/reviews/types").ReviewSnapshot | null; after: import("@/lib/reviews/types").ReviewSnapshot | null; createdAt: Generated<Date> };
  reviewGc: { storagePath: string; notBefore: Date; leaseUntil: Date | null; leaseId: string | null; attempts: Generated<number> };
  reviewRate: { userId: string; kind: string; window: string; count: number };
  account: AccountTable;
  blob: BlobTable;
  deviceCode: DeviceCodeTable;
  invitation: InvitationTable;
  member: MemberTable;
  organization: OrganizationTable;
  profileLinks: ProfileLinks & { userId: string };
  session: SessionTable;
  user: UserTable;
  verification: VerificationTable;
}

interface AccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: Generated<Date>;
  updatedAt: Date;
}

interface DeviceCodeTable {
  id: string;
  deviceCode: string;
  userCode: string;
  userId: string | null;
  expiresAt: Date;
  status: string;
  lastPolledAt: Date | null;
  pollingInterval: number | null;
  clientId: string | null;
  scope: string | null;
}

interface InvitationTable {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: Generated<string>;
  expiresAt: Date;
  createdAt: Generated<Date>;
  inviterId: string;
}

interface MemberTable {
  id: string;
  organizationId: string;
  userId: string;
  role: Generated<string>;
  createdAt: Date;
}

interface OrganizationTable {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
  metadata: string | null;
}

interface SessionTable {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Generated<Date>;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  activeOrganizationId: string | null;
}

interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: Generated<boolean>;
  image: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  username: string | null;
  displayUsername: string | null;
}

interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface BlobTable {
  organizationId: string;
  hash: string;
  contentType: string;
  byteSize: number;
  data: Buffer | null;
  storagePath: string | null;
  width: number | null;
  height: number | null;
  createdAt: Generated<Date>;
}
