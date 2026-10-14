import { z } from "zod";

export const SUPPORTED_DOCUMENT_SCHEMAS = { design: [1], report: [2] } as const;
export type DocumentType = keyof typeof SUPPORTED_DOCUMENT_SCHEMAS;
export type ReaderCapabilities = { versions: readonly number[]; explicit: boolean };
export type Compatibility = {
  status: "supported" | "unsupported" | "invalid";
  schemaVersion: number;
  message?: string;
};

export class DocumentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function assertSupportedSchema(value: unknown, documentType: DocumentType): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DocumentError(422, "invalid_document", "schemaVersion must be a positive safe integer.");
  }
  const supported: readonly number[] = SUPPORTED_DOCUMENT_SCHEMAS[documentType];
  if (!supported.includes(value)) {
    throw new DocumentError(422, "unsupported_schema_version", "The requested document schema is not supported.", {
      documentType, schemaVersion: value, supportedSchemaVersions: supported,
    });
  }
}

export function readerCapabilities(request: Request, documentType: DocumentType): ReaderCapabilities {
  const raw = request.headers.get(`x-subtubes-${documentType}-schema-versions`);
  if (raw === null) {
    return { versions: documentType === "design" ? [1] : [2], explicit: false };
  }
  const parts = raw.split(",").map((part) => part.trim());
  if (raw.length > 256 || parts.length > 16 || parts.some((part) =>
    !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))) {
    throw new DocumentError(422, "invalid_reader_capabilities", "Declare 1-16 positive safe-integer schema versions, separated by commas.");
  }
  return { versions: [...new Set(parts.map(Number))], explicit: true };
}

export function schemaCompatibility(schemaVersion: number, documentType: DocumentType, reader: ReaderCapabilities): Compatibility {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return { status: "invalid", schemaVersion, message: "Invalid document" };
  }
  const serverSchemas: readonly number[] = SUPPORTED_DOCUMENT_SCHEMAS[documentType];
  if (!reader.versions.includes(schemaVersion) || !serverSchemas.includes(schemaVersion)) {
    return { status: "unsupported", schemaVersion, message: "This document requires a newer app. Update Subtubes IRE." };
  }
  return { status: "supported", schemaVersion };
}

export function requireReadableSchema(schemaVersion: number, documentType: DocumentType, reader: ReaderCapabilities) {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new DocumentError(422, "invalid_document", "Invalid stored document schema.");
  }
  const supported: readonly number[] = SUPPORTED_DOCUMENT_SCHEMAS[documentType];
  if (!reader.versions.includes(schemaVersion) || !supported.includes(schemaVersion)) {
    throw new DocumentError(426, "upgrade_required", "This document requires a newer app or server. No content was changed.", {
      documentType, schemaVersion, readerSchemaVersions: reader.versions, supportedSchemaVersions: supported,
    });
  }
}

export const jsonObjectSchema = z.record(z.string(), z.json());

export function assertAttachmentReferences(content: unknown, hashes: readonly string[]) {
  const referenced = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/attachment:([a-fA-F0-9]{64})(?![a-fA-F0-9])/g)) {
        referenced.add(match[1].toLowerCase());
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(content);
  const known = new Set(hashes.map((hash) => hash.replace(/^sha256:/, "").toLowerCase()));
  const missing = [...referenced].filter((hash) => !known.has(hash));
  if (missing.length) {
    throw new DocumentError(422, "invalid_document", "Every attachment must appear in refs.blobs.", { hashes: missing });
  }
}

export function parseStoredJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`Invalid stored JSON: ${label}`, error);
    throw new DocumentError(422, "invalid_document", "Invalid document");
  }
}

export function validateStored<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(`Invalid stored document: ${label}`, result.error);
    throw new DocumentError(422, "invalid_document", "Invalid document");
  }
  return result.data;
}
