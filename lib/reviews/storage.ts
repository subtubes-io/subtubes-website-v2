import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  list,
  presignUrl,
  type GetBlobResult,
  type HeadBlobResult,
  type IssueSignedTokenOptions,
  type ListCommandOptions,
  type PresignUrlOptions,
} from '@vercel/blob';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_URL_TTL_MS = 5 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 30 * 1000;
const LIST_PAGE_SIZE = 1000;
const ALLOWED_CONTENT_TYPES = ['application/gzip', 'application/x-git-bundle'];

export interface ReviewStorage {
  mintUpload(
    path: string,
    bytes: number,
    contentType: string,
    expiresAt: Date,
  ): Promise<{
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  mintDownload(path: string): Promise<string>;
  verify(path: string, hash: string, bytes: number, contentType: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<Array<{ pathname: string; uploadedAt: Date }>>;
}

export interface ReviewStorageProvider {
  issueSignedToken: typeof issueSignedToken;
  presignUrl: typeof presignUrl;
  head: typeof head;
  get: typeof get;
  del: typeof del;
  list: typeof list;
}

export class ReviewStorageError extends Error {
  constructor(
    readonly code:
      | 'TOKEN_MISSING'
      | 'INVALID_PATH'
      | 'INVALID_ARGUMENT'
      | 'PROVIDER_ERROR'
      | 'OBJECT_NOT_FOUND'
      | 'CONTENT_MISMATCH'
      | 'STREAM_ERROR'
      | 'PAGINATION_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewStorageError';
  }
}

const defaultProvider: ReviewStorageProvider = {
  issueSignedToken,
  presignUrl,
  head,
  get,
  del,
  list,
};

const objectPathPattern =
  /^reviews\/([A-Za-z0-9_-]{1,128})\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-f0-9]{64})$/;
const mimeTypePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function accessToken(): string {
  const token = process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
  if (!token?.trim()) {
    throw new ReviewStorageError(
      'TOKEN_MISSING',
      'Review blob storage is not configured: REVIEWS_BLOB_READ_WRITE_TOKEN is required.',
    );
  }
  return token;
}

function validatePath(path: string): void {
  if (typeof path !== 'string' || !objectPathPattern.test(path)) {
    throw new ReviewStorageError(
      'INVALID_PATH',
      'Review blob path must be reviews/<org>/uploads/<uuid>/<sha256>.',
    );
  }
}

function validatePrefix(prefix: string): void {
  const prefixPattern =
    /^reviews\/[A-Za-z0-9_-]{1,128}\/uploads\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?(?:[a-f0-9]{0,64})?)?$/;
  if (typeof prefix !== 'string' || !prefixPattern.test(prefix) || prefix.includes('..')) {
    throw new ReviewStorageError(
      'INVALID_PATH',
      'Review blob prefix must stay within reviews/<org>/uploads/.',
    );
  }
}

function validatePayload(bytes: number, contentType: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES) {
    throw new ReviewStorageError(
      'INVALID_ARGUMENT',
      `Review blob size must be an integer between 1 and ${MAX_UPLOAD_BYTES} bytes.`,
    );
  }
  if (!mimeTypePattern.test(contentType) || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ReviewStorageError(
      'INVALID_ARGUMENT',
      'Review blob content type must be application/gzip or application/x-git-bundle.',
    );
  }
}

function providerError(operation: string): ReviewStorageError {
  return new ReviewStorageError(
    'PROVIDER_ERROR',
    `Review blob storage ${operation} failed.`,
  );
}

function assertMetadata(
  metadata: Pick<HeadBlobResult, 'pathname' | 'size' | 'contentType'>,
  path: string,
  bytes: number,
  contentType: string,
): void {
  if (
    metadata.pathname !== path ||
    metadata.size !== bytes ||
    metadata.contentType !== contentType
  ) {
    throw new ReviewStorageError(
      'CONTENT_MISMATCH',
      'Review blob size, content type, or pathname does not match the expected payload.',
    );
  }
}

function withSignalTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ReviewStorageError('STREAM_ERROR', 'Review blob verification timed out.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new ReviewStorageError('STREAM_ERROR', 'Review blob verification timed out.'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function hashStream(
  stream: ReadableStream<Uint8Array>,
  expectedBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const hash = createHash('sha256');
  let readBytes = 0;

  try {
    while (true) {
      const { done, value } = await withSignalTimeout(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ReviewStorageError('STREAM_ERROR', 'Review blob returned an invalid data stream.');
      }

      readBytes += value.byteLength;
      if (readBytes > expectedBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ReviewStorageError(
          'CONTENT_MISMATCH',
          'Review blob contains more bytes than the expected payload.',
        );
      }
      hash.update(value);
    }
  } catch (error) {
    if (error instanceof ReviewStorageError) throw error;
    throw new ReviewStorageError('STREAM_ERROR', 'Review blob could not be read for verification.');
  } finally {
    if (signal.aborted) void reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }

  if (readBytes !== expectedBytes) {
    throw new ReviewStorageError(
      'CONTENT_MISMATCH',
      'Review blob contains a different number of bytes than the expected payload.',
    );
  }
  return hash.digest('hex');
}

export function createReviewStorage(
  provider: ReviewStorageProvider = defaultProvider,
  verificationTimeoutMs = VERIFY_TIMEOUT_MS,
): ReviewStorage {
  return {
    async mintUpload(path, bytes, contentType, expiresAt) {
      validatePath(path);
      validatePayload(bytes, contentType);
      const now = Date.now();
      if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) {
        throw new ReviewStorageError(
          'INVALID_ARGUMENT',
          'Review blob upload expiry must be a valid future date.',
        );
      }
      const effectiveExpiry = new Date(Math.min(expiresAt.getTime(), now + MAX_URL_TTL_MS));

      const token = accessToken();
      const tokenOptions: IssueSignedTokenOptions = {
        token,
        pathname: path,
        operations: ['put'],
        validUntil: effectiveExpiry.getTime(),
        allowedContentTypes: [contentType],
        maximumSizeInBytes: bytes,
      };
      try {
        const signed = await provider.issueSignedToken(tokenOptions);
        const presignOptions: PresignUrlOptions & { access: 'private' } = {
          access: 'private',
          operation: 'put',
          pathname: path,
          validUntil: effectiveExpiry.getTime(),
          allowedContentTypes: [contentType],
          maximumSizeInBytes: bytes,
          allowOverwrite: false,
          addRandomSuffix: false,
        };
        const { presignedUrl } = await provider.presignUrl(signed, presignOptions);
        return {
          method: 'PUT',
          url: presignedUrl,
          headers: { 'content-type': contentType },
          expiresAt: effectiveExpiry.toISOString(),
        };
      } catch {
        throw providerError('upload URL creation');
      }
    },

    async mintDownload(path) {
      validatePath(path);
      const token = accessToken();
      const validUntil = Date.now() + MAX_URL_TTL_MS;
      try {
        const signed = await provider.issueSignedToken({
          token,
          pathname: path,
          operations: ['get'],
          validUntil,
        });
        const { presignedUrl } = await provider.presignUrl(signed, {
          access: 'private',
          operation: 'get',
          pathname: path,
          validUntil,
          useCache: false,
        });
        return presignedUrl;
      } catch {
        throw providerError('download URL creation');
      }
    },

    async verify(path, hash, bytes, contentType) {
      validatePath(path);
      validatePayload(bytes, contentType);
      if (!/^[a-f0-9]{64}$/.test(hash) || path.split('/').at(-1) !== hash) {
        throw new ReviewStorageError(
          'INVALID_ARGUMENT',
          'Review blob SHA-256 must match the hash in its path.',
        );
      }

      const token = accessToken();
      if (!Number.isSafeInteger(verificationTimeoutMs) || verificationTimeoutMs <= 0) {
        throw new ReviewStorageError(
          'INVALID_ARGUMENT',
          'Review blob verification timeout must be a positive integer.',
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), verificationTimeoutMs);
      let metadata: HeadBlobResult;
      try {
        metadata = await withSignalTimeout(
          provider.head(path, { token, abortSignal: controller.signal }),
          controller.signal,
        );
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof BlobNotFoundError) {
          throw new ReviewStorageError('OBJECT_NOT_FOUND', 'Review blob could not be found.');
        }
        throw providerError('metadata lookup');
      }

      try {
        assertMetadata(metadata, path, bytes, contentType);

        let result: GetBlobResult | null;
        try {
          result = await withSignalTimeout(
            provider.get(path, {
              token,
              access: 'private',
              useCache: false,
              abortSignal: controller.signal,
            }),
            controller.signal,
          );
        } catch (error) {
          if (error instanceof BlobNotFoundError) {
            throw new ReviewStorageError('OBJECT_NOT_FOUND', 'Review blob could not be found.');
          }
          throw providerError('private object read');
        }
        if (!result) {
          throw new ReviewStorageError('OBJECT_NOT_FOUND', 'Review blob could not be found.');
        }
        if (
          result.statusCode !== 200 ||
          result.blob.pathname !== path ||
          result.blob.size !== bytes ||
          result.blob.contentType !== contentType
        ) {
          throw new ReviewStorageError(
            'CONTENT_MISMATCH',
            'Review blob size, content type, or pathname does not match the expected payload.',
          );
        }

        const actualHash = await hashStream(result.stream, bytes, controller.signal);
        const expected = Buffer.from(hash, 'hex');
        const actual = Buffer.from(actualHash, 'hex');
        if (!timingSafeEqual(actual, expected)) {
          throw new ReviewStorageError('CONTENT_MISMATCH', 'Review blob SHA-256 does not match.');
        }
      } finally {
        clearTimeout(timeout);
      }
    },

    async delete(path) {
      validatePath(path);
      const token = accessToken();
      try {
        await provider.del(path, { token });
      } catch {
        throw providerError('deletion');
      }
    },

    async list(prefix) {
      validatePrefix(prefix);
      const token = accessToken();
      const items: Array<{ pathname: string; uploadedAt: Date }> = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;

      try {
        while (true) {
          const options: ListCommandOptions = {
            token,
            prefix,
            limit: LIST_PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          };
          const page = await provider.list(options);
          for (const blob of page.blobs) {
            validatePath(blob.pathname);
            if (!blob.pathname.startsWith(prefix) || !(blob.uploadedAt instanceof Date) || !Number.isFinite(blob.uploadedAt.getTime())) {
              throw new ReviewStorageError(
                'PROVIDER_ERROR',
                'Review blob storage returned invalid listing metadata.',
              );
            }
            items.push({ pathname: blob.pathname, uploadedAt: blob.uploadedAt });
          }
          if (!page.hasMore) break;
          if (!page.cursor || cursors.has(page.cursor)) {
            throw new ReviewStorageError(
              'PAGINATION_ERROR',
              'Review blob listing returned an invalid pagination cursor.',
            );
          }
          cursors.add(page.cursor);
          cursor = page.cursor;
        }
      } catch (error) {
        if (error instanceof ReviewStorageError) throw error;
        throw providerError('listing');
      }
      return items;
    },
  };
}

export const reviewStorage = createReviewStorage();
