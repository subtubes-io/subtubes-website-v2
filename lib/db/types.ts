import type { ColumnType, Generated } from "kysely";
import type { ProfileLinks } from "@/lib/profile-links";

export interface Database {
  account: AccountTable;
  blob: BlobTable;
  deviceCode: DeviceCodeTable;
  invitation: InvitationTable;
  llmAccount: LlmAccountTable;
  llmApiKey: LlmApiKeyTable;
  llmCreditTransaction: LlmCreditTransactionTable;
  llmGlobalPeriod: LlmGlobalPeriodTable;
  llmMemberLimit: LlmMemberLimitTable;
  llmMemberPeriod: LlmMemberPeriodTable;
  llmOrgPeriod: LlmOrgPeriodTable;
  llmUsage: LlmUsageTable;
  member: MemberTable;
  organization: OrganizationTable;
  profileLinks: ProfileLinks & { userId: string };
  rateLimitCounter: RateLimitCounterTable;
  session: SessionTable;
  stripeEvent: StripeEventTable;
  user: UserTable;
  verification: VerificationTable;
}

// pg returns bigint columns as strings; read them with Number() (micro-dollars stay far below 2^53).
type BigIntColumn = ColumnType<string, number | string, number | string>;
type DefaultedBigInt = ColumnType<string, number | string | undefined, number | string>;

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

interface LlmAccountTable {
  organizationId: string;
  creditMicros: DefaultedBigInt;
  monthlyLimitMicros: BigIntColumn | null;
  enabledModels: string[] | null;
  freeAllowanceMicros: BigIntColumn | null;
  planId: Generated<string>;
  planStatus: string | null;
  subscriptionAllowanceMicros: DefaultedBigInt;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: Generated<boolean>;
  updatedBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface LlmMemberLimitTable {
  organizationId: string;
  userId: string;
  monthlyLimitMicros: BigIntColumn | null;
  disabled: Generated<boolean>;
  updatedBy: string | null;
  updatedAt: Generated<Date>;
}

interface LlmApiKeyTable {
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  prefix: string;
  label: string;
  createdAt: Generated<Date>;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface LlmOrgPeriodTable {
  organizationId: string;
  period: string;
  spentMicros: DefaultedBigInt;
  reservedMicros: DefaultedBigInt;
  allowanceUsedMicros: DefaultedBigInt;
  requestCount: Generated<number>;
}

interface LlmMemberPeriodTable {
  organizationId: string;
  userId: string;
  period: string;
  spentMicros: DefaultedBigInt;
  reservedMicros: DefaultedBigInt;
  requestCount: Generated<number>;
}

interface LlmGlobalPeriodTable {
  period: string;
  spentMicros: DefaultedBigInt;
  reservedMicros: DefaultedBigInt;
}

export type LlmUsageStatus = "reserved" | "settled" | "aborted" | "failed";

interface LlmUsageTable {
  id: string;
  organizationId: string;
  userId: string | null;
  apiKeyId: string | null;
  period: string;
  model: string;
  upstreamModel: string;
  stream: boolean;
  status: LlmUsageStatus;
  estimateMicros: BigIntColumn;
  estimatedInputTokens: number;
  inputTokens: Generated<number>;
  cachedInputTokens: Generated<number>;
  outputTokens: Generated<number>;
  reasoningTokens: Generated<number>;
  streamedChars: Generated<number>;
  upstreamCostMicros: BigIntColumn | null;
  chargedMicros: BigIntColumn | null;
  allowanceChargedMicros: BigIntColumn | null;
  creditChargedMicros: BigIntColumn | null;
  generationId: string | null;
  upstreamStatus: number | null;
  createdAt: Generated<Date>;
  settledAt: Date | null;
}

interface LlmCreditTransactionTable {
  id: string;
  organizationId: string;
  amountMicros: BigIntColumn;
  kind: "purchase" | "adjustment" | "refund";
  description: string;
  stripeCheckoutSessionId: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
}

interface StripeEventTable {
  id: string;
  type: string;
  createdAt: Generated<Date>;
}

interface RateLimitCounterTable {
  key: string;
  windowStart: Date;
  count: number;
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
