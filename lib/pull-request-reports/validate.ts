import { createHash } from "node:crypto";
import { ApiError } from "./errors";
import { ACCEPTED_SCHEMA_VERSIONS, LIMITS, publishRequestSchema, type PublishRequest } from "./schema";

export interface ValidatedPublish {
  request: PublishRequest;
  sizeBytes: number;
  bodySha256: string;
}

const MAX_ISSUES = 20;
const MAX_MESSAGE = 200;

// The one place an untrusted publish body is accepted or refused. Everything after it may rely on the request being exactly the shape
// of schema.ts. Throws ApiError: payload-too-large, bad-request, unsupported-schema-version or invalid-report.
export function validatePublishBody(body: Uint8Array): ValidatedPublish {
  if (body.byteLength > LIMITS.maxBodyBytes) {
    throw new ApiError("payload-too-large", "This report is too large to publish.", { limitBytes: LIMITS.maxBodyBytes });
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ApiError("bad-request", "The body is not valid UTF-8 text.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError("bad-request", "The body is not valid JSON.");
  }

  const unsafe = findUnsafeValue(raw);
  if (unsafe) throw new ApiError("invalid-report", "The report cannot be stored.", { issues: [unsafe] });

  const version = declaredSchemaVersion(raw);
  if (version !== undefined && !ACCEPTED_SCHEMA_VERSIONS.includes(version)) {
    throw new ApiError("unsupported-schema-version", "This report was written with a version of the format that is not accepted. Update the app and publish again.", {
      supported: ACCEPTED_SCHEMA_VERSIONS,
    });
  }

  const parsed = publishRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message.slice(0, MAX_MESSAGE),
    }));
    throw new ApiError("invalid-report", "The report does not match the report format.", { issues });
  }

  return {
    request: parsed.data,
    sizeBytes: body.byteLength,
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
}

function declaredSchemaVersion(raw: unknown): number | undefined {
  if (!isRecord(raw) || !isRecord(raw.bundle)) return undefined;
  const version = raw.bundle.schemaVersion;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// What JSON allows but the database or the website must not take: nesting that is too deep, characters PostgreSQL cannot store (NUL, a
// lone surrogate), and keys that name an object's prototype. Iterative, so a deeply nested body cannot exhaust the stack.
function findUnsafeValue(root: unknown): { path: string; message: string } | null {
  const stack: { value: unknown; path: string[]; depth: number }[] = [{ value: root, path: [], depth: 0 }];
  while (stack.length > 0) {
    const { value, path, depth } = stack.pop()!;
    const where = path.join(".");
    if (typeof value === "string") {
      const problem = badText(value);
      if (problem) return { path: where, message: problem };
    } else if (typeof value === "object" && value !== null) {
      if (depth >= LIMITS.maxDepth) return { path: where, message: `Is nested more than ${LIMITS.maxDepth} levels deep` };
      if (Array.isArray(value)) {
        value.forEach((item, index) => stack.push({ value: item, path: [...path, String(index)], depth: depth + 1 }));
      } else {
        for (const [key, item] of Object.entries(value)) {
          if (key === "__proto__") return { path: where, message: "Has a key that is not allowed" };
          const problem = badText(key);
          if (problem) return { path: where, message: `Has a key that ${problem.toLowerCase()}` };
          stack.push({ value: item, path: [...path, key], depth: depth + 1 });
        }
      }
    }
  }
  return null;
}

function badText(text: string): string | null {
  if (text.includes("\u0000")) return "Contains a null character";
  if (!text.isWellFormed()) return "Contains text that is not valid Unicode";
  return null;
}
