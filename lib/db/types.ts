import type { Generated } from "kysely";
import type { ProfileLinks } from "@/lib/profile-links";

export interface Database {
  account: AccountTable;
  blob: BlobTable;
  blobUpload: BlobUploadTable;
  design: DesignTable;
  designVersion: DesignVersionTable;
  deviceCode: DeviceCodeTable;
  invitation: InvitationTable;
  member: MemberTable;
  organization: OrganizationTable;
  profileLinks: ProfileLinks & { userId: string };
  report: ReportTable;
  reportSnapshot: ReportSnapshotTable;
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

interface BlobUploadTable {
  id: string;
  organizationId: string;
  ownerId: string;
  hash: string;
  contentType: string;
  byteSize: number;
  resourceKind: "report" | "design";
  resourceId: string;
  storagePath: string;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Generated<Date>;
}

interface DesignTable {
  id: string;
  organizationId: string;
  ownerId: string;
  preferredVersionId: string | null;
  headGeneration: Generated<number>;
  versionCount: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface DesignVersionTable {
  id: string;
  designId: string;
  organizationId: string;
  number: number;
  uploadId: string;
  requestHash: string;
  contentHash: string;
  authorId: string;
  deviceLabel: string | null;
  name: string;
  kind: string;
  schemaVersion: number;
  revision: number;
  content: string;
  refs: string;
  snapshot: string | null;
  createdAt: Generated<Date>;
}

interface ReportTable {
  id: string;
  organizationId: string;
  ownerId: string;
  projectName: string;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  report: string;
  refs: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface ReportSnapshotTable {
  id: string;
  reportId: string;
  organizationId: string;
  ownerId: string;
  number: number;
  takenAt: Date;
  note: string | null;
  commit: string | null;
  schemaVersion: number;
  contentHash: string;
  report: string;
  refs: string;
  createdAt: Generated<Date>;
}
