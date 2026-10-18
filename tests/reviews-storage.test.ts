import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createReviewStorage,
  ReviewStorageError,
  type ReviewStorageProvider,
} from '../lib/reviews/storage';

const path =
  'reviews/org-123/uploads/123e4567-e89b-12d3-a456-426614174000/' +
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const token = 'unit-test-token';
const payload = new TextEncoder().encode('abc');

function withToken<T>(callback: () => Promise<T>): Promise<T> {
  const previous = process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
  process.env.REVIEWS_BLOB_READ_WRITE_TOKEN = token;
  return callback().finally(() => {
    if (previous === undefined) delete process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
    else process.env.REVIEWS_BLOB_READ_WRITE_TOKEN = previous;
  });
}

function fixture(
  overrides: Partial<ReviewStorageProvider> = {},
): ReviewStorageProvider {
  return {
    issueSignedToken: async () =>
      ({
        delegationToken: 'delegation',
        clientSigningToken: 'client-signing',
        validUntil: Date.now() + 60_000,
      }) as Awaited<ReturnType<ReviewStorageProvider['issueSignedToken']>>,
    presignUrl: async () =>
      ({ presignedUrl: 'https://private.example/signed' }) as Awaited<
        ReturnType<ReviewStorageProvider['presignUrl']>
      >,
    head: async () =>
      ({
        pathname: path,
        size: payload.byteLength,
        contentType: 'application/gzip',
      }) as Awaited<ReturnType<ReviewStorageProvider['head']>>,
    get: async () =>
      ({
        statusCode: 200,
        blob: {
          pathname: path,
          size: payload.byteLength,
          contentType: 'application/gzip',
        },
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
      }) as Awaited<ReturnType<ReviewStorageProvider['get']>>,
    del: async () => undefined,
    list: (async () =>
      ({
        blobs: [],
        hasMore: false,
      })) as ReviewStorageProvider['list'],
    ...overrides,
  };
}

function storage(provider: ReviewStorageProvider) {
  return createReviewStorage(provider);
}

test('upload URLs are private, operation- and pathname-scoped, and type/size-limited', async () => {
  await withToken(async () => {
    let issueOptions: Record<string, unknown> | undefined;
    let presignOptions: Record<string, unknown> | undefined;
    const provider = fixture({
      issueSignedToken: async (options) => {
        issueOptions = options as unknown as Record<string, unknown>;
        return {
          delegationToken: 'delegation',
          clientSigningToken: 'signing',
          validUntil: Date.now() + 60_000,
        };
      },
      presignUrl: async (_signed, options) => {
        presignOptions = options as unknown as Record<string, unknown>;
        return { presignedUrl: 'https://private.example/upload' };
      },
    });
    const expiresAt = new Date(Date.now() + 60_000);
    const result = await storage(provider).mintUpload(
      path,
      3,
      'application/gzip',
      expiresAt,
    );

    assert.deepEqual(result, {
      method: 'PUT',
      url: 'https://private.example/upload',
      headers: { 'content-type': 'application/gzip' },
      expiresAt: expiresAt.toISOString(),
    });
    assert.equal(issueOptions?.token, token);
    assert.equal(issueOptions?.pathname, path);
    assert.deepEqual(issueOptions?.operations, ['put']);
    assert.equal(issueOptions?.maximumSizeInBytes, 3);
    assert.deepEqual(issueOptions?.allowedContentTypes, ['application/gzip']);
    assert.equal(presignOptions?.access, 'private');
    assert.equal(presignOptions?.allowOverwrite, false);
    assert.equal(presignOptions?.addRandomSuffix, false);
  });
});

test('download URL is scoped to a private GET', async () => {
  await withToken(async () => {
    let issueOptions: Record<string, unknown> | undefined;
    let presignOptions: Record<string, unknown> | undefined;
    const provider = fixture({
      issueSignedToken: async (options) => {
        issueOptions = options as unknown as Record<string, unknown>;
        return {
          delegationToken: 'delegation',
          clientSigningToken: 'signing',
          validUntil: Date.now() + 60_000,
        };
      },
      presignUrl: async (_signed, options) => {
        presignOptions = options as unknown as Record<string, unknown>;
        return { presignedUrl: 'https://private.example/download' };
      },
    });

    assert.equal(
      await storage(provider).mintDownload(path),
      'https://private.example/download',
    );
    assert.equal(issueOptions?.pathname, path);
    assert.deepEqual(issueOptions?.operations, ['get']);
    assert.equal(presignOptions?.access, 'private');
    assert.equal(presignOptions?.operation, 'get');
    assert.equal(presignOptions?.useCache, false);
  });
});

test('upload expiry is capped at five minutes and payload requirements are strict', async () => {
  await withToken(async () => {
    let signedExpiry: number | undefined;
    let presignedExpiry: number | undefined;
    const provider = fixture({
      issueSignedToken: async (options) => {
        signedExpiry = options.validUntil;
        return {
          delegationToken: 'delegation',
          clientSigningToken: 'signing',
          validUntil: options.validUntil!,
        };
      },
      presignUrl: async (_signed, options) => {
        presignedExpiry = options.validUntil;
        return { presignedUrl: 'https://private.example/upload' };
      },
    });
    const before = Date.now();
    const result = await storage(provider).mintUpload(
      path,
      3,
      'application/x-git-bundle',
      new Date(before + 10 * 60 * 1000),
    );
    const expiresAt = Date.parse(result.expiresAt);
    const schedulingToleranceMs = 1000;
    assert.ok(expiresAt <= before + 5 * 60 * 1000 + schedulingToleranceMs);
    assert.equal(signedExpiry, expiresAt);
    assert.equal(presignedExpiry, expiresAt);

    await assert.rejects(
      storage(provider).mintUpload(path, 0, 'application/gzip', new Date(Date.now() + 1000)),
      { code: 'INVALID_ARGUMENT' },
    );
    await assert.rejects(
      storage(provider).mintUpload(path, 3, 'application/octet-stream', new Date(Date.now() + 1000)),
      { code: 'INVALID_ARGUMENT' },
    );
  });
});

test('verify checks private object metadata and hashes the streamed bytes', async () => {
  await withToken(async () => {
    let getOptions: Record<string, unknown> | undefined;
    const provider = fixture({
      get: async (_path, options) => {
        getOptions = options as unknown as Record<string, unknown>;
        return {
          statusCode: 200,
          blob: {
            pathname: path,
            size: payload.byteLength,
            contentType: 'application/gzip',
          },
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(payload.slice(0, 1));
              controller.enqueue(payload.slice(1));
              controller.close();
            },
          }),
        } as Awaited<ReturnType<ReviewStorageProvider['get']>>;
      },
    });

    await storage(provider).verify(
      path,
      createHash('sha256').update(payload).digest('hex'),
      payload.byteLength,
      'application/gzip',
    );
    assert.equal(getOptions?.access, 'private');
    assert.equal(getOptions?.useCache, false);
    assert.equal(getOptions?.token, token);
  });
});

test('verify supports a streamed 100 MiB bundle without buffering it', async () => {
  await withToken(async () => {
    const bytes = 100 * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const expectedHash = createHash('sha256');
    for (let i = 0; i < bytes / chunk.byteLength; i++) expectedHash.update(chunk);
    const hash = expectedHash.digest('hex');
    const bundlePath = path.replace(/ba7816bf.*$/, hash);
    const provider = fixture({
      head: async () =>
        ({
          pathname: bundlePath,
          size: bytes,
          contentType: 'application/gzip',
        }) as Awaited<ReturnType<ReviewStorageProvider['head']>>,
      get: async () =>
        ({
          statusCode: 200,
          blob: {
            pathname: bundlePath,
            size: bytes,
            contentType: 'application/gzip',
          },
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              for (let i = 0; i < bytes / chunk.byteLength; i++) controller.enqueue(chunk);
              controller.close();
            },
          }),
        }) as Awaited<ReturnType<ReviewStorageProvider['get']>>,
    });

    await storage(provider).verify(
      bundlePath,
      hash,
      bytes,
      'application/gzip',
    );
  });
});

test('verify rejects mismatched metadata, truncated streams, oversized streams, and bad hashes', async () => {
  await withToken(async () => {
    const metadataMismatch = storage(
      fixture({
        head: async () =>
          ({
            pathname: path,
            size: 4,
            contentType: 'application/gzip',
          }) as Awaited<ReturnType<ReviewStorageProvider['head']>>,
      }),
    );
    await assert.rejects(
      metadataMismatch.verify(path, path.split('/').at(-1)!, 3, 'application/gzip'),
      { code: 'CONTENT_MISMATCH' },
    );

    const truncated = storage(
      fixture({
        get: async () =>
          ({
            statusCode: 200,
            blob: {
              pathname: path,
              size: 3,
              contentType: 'application/gzip',
            },
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(payload.slice(0, 2));
                controller.close();
              },
            }),
          }) as Awaited<ReturnType<ReviewStorageProvider['get']>>,
      }),
    );
    await assert.rejects(
      truncated.verify(path, path.split('/').at(-1)!, 3, 'application/gzip'),
      { code: 'CONTENT_MISMATCH' },
    );

    const oversized = storage(
      fixture({
        get: async () =>
          ({
            statusCode: 200,
            blob: {
              pathname: path,
              size: 3,
              contentType: 'application/gzip',
            },
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(4));
                controller.close();
              },
            }),
          }) as Awaited<ReturnType<ReviewStorageProvider['get']>>,
      }),
    );
    await assert.rejects(
      oversized.verify(path, path.split('/').at(-1)!, 3, 'application/gzip'),
      { code: 'CONTENT_MISMATCH' },
    );

    const digestMismatch = storage(
      fixture({
        get: async () =>
          ({
            statusCode: 200,
            blob: {
              pathname: path,
              size: 3,
              contentType: 'application/gzip',
            },
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('xyz'));
                controller.close();
              },
            }),
          }) as Awaited<ReturnType<ReviewStorageProvider['get']>>,
      }),
    );
    await assert.rejects(
      digestMismatch.verify(path, path.split('/').at(-1)!, 3, 'application/gzip'),
      { code: 'CONTENT_MISMATCH' },
    );

    await assert.rejects(
      storage(fixture()).verify(path, '0'.repeat(64), 3, 'application/gzip'),
      { code: 'INVALID_ARGUMENT' },
    );
  });
});

test('verify bounds provider and stream reads with an AbortSignal timeout', async () => {
  await withToken(async () => {
    let headSignal: AbortSignal | undefined;
    let getSignal: AbortSignal | undefined;
    const provider = fixture({
      head: async (_path, options) => {
        headSignal = options?.abortSignal;
        return {
          pathname: path,
          size: payload.byteLength,
          contentType: 'application/gzip',
        } as Awaited<ReturnType<ReviewStorageProvider['head']>>;
      },
      get: async (_path, options) => {
        getSignal = options?.abortSignal;
        return {
          statusCode: 200,
          blob: {
            pathname: path,
            size: payload.byteLength,
            contentType: 'application/gzip',
          },
          stream: new ReadableStream<Uint8Array>(),
        } as Awaited<ReturnType<ReviewStorageProvider['get']>>;
      },
    });
    await assert.rejects(
      createReviewStorage(provider, 10).verify(
        path,
        path.split('/').at(-1)!,
        payload.byteLength,
        'application/gzip',
      ),
      { code: 'STREAM_ERROR' },
    );
    assert.equal(headSignal, getSignal);
    assert.equal(headSignal?.aborted, true);
    assert.equal(getSignal?.aborted, true);
  });
});

test('missing explicit review token fails without falling back to the generic Blob token', async () => {
  const previousReviewToken = process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
  const previousGenericToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'must-not-be-used';
  try {
    await assert.rejects(storage(fixture()).mintDownload(path), {
      code: 'TOKEN_MISSING',
      message: /REVIEWS_BLOB_READ_WRITE_TOKEN/,
    });
  } finally {
    if (previousReviewToken === undefined) delete process.env.REVIEWS_BLOB_READ_WRITE_TOKEN;
    else process.env.REVIEWS_BLOB_READ_WRITE_TOKEN = previousReviewToken;
    if (previousGenericToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousGenericToken;
  }
});

test('invalid paths, upload limits, and content types are rejected before provider access', async () => {
  await withToken(async () => {
    const provider = fixture();
    const api = storage(provider);
    await assert.rejects(
      api.mintUpload('reviews/org/uploads/../../unsafe', 3, 'text/plain', new Date(Date.now() + 1000)),
      { code: 'INVALID_PATH' },
    );
    await assert.rejects(
      api.mintUpload(path, 100 * 1024 * 1024 + 1, 'text/plain', new Date(Date.now() + 1000)),
      { code: 'INVALID_ARGUMENT' },
    );
    await assert.rejects(
      api.mintUpload(path, 3, 'text/plain\r\nx: y', new Date(Date.now() + 1000)),
      { code: 'INVALID_ARGUMENT' },
    );
  });
});

test('delete uses the explicit token and list follows all pages within validated prefixes', async () => {
  await withToken(async () => {
    let deleteOptions: Record<string, unknown> | undefined;
    const listOptions: Array<Record<string, unknown>> = [];
    const provider = fixture({
      del: async (_path, options) => {
        deleteOptions = options as unknown as Record<string, unknown>;
      },
      list: (async (options) => {
        listOptions.push(options as unknown as Record<string, unknown>);
        if (options?.cursor === undefined) {
          return {
            blobs: [
              {
                pathname: path,
                uploadedAt: new Date('2025-01-01T00:00:00Z'),
              },
            ],
            hasMore: true,
            cursor: 'next',
          } as Awaited<ReturnType<ReviewStorageProvider['list']>>;
        }
        return {
          blobs: [
            {
              pathname: path.replace('org-123', 'org-123').replace(/ba7816bf.*$/, 'b'.repeat(64)),
              uploadedAt: new Date('2025-01-02T00:00:00Z'),
            },
          ],
          hasMore: false,
        } as Awaited<ReturnType<ReviewStorageProvider['list']>>;
      }) as ReviewStorageProvider['list'],
    });
    const api = storage(provider);

    await api.delete(path);
    const listed = await api.list('reviews/org-123/uploads/');
    assert.equal(deleteOptions?.token, token);
    assert.equal(listOptions.length, 2);
    assert.equal(listOptions[0].prefix, 'reviews/org-123/uploads/');
    assert.equal(listOptions[1].cursor, 'next');
    assert.equal(listed.length, 2);
    assert.deepEqual(Object.keys(listed[0]).sort(), ['pathname', 'uploadedAt']);
  });
});

test('provider failures are explicit but do not expose provider messages or credentials', async () => {
  await withToken(async () => {
    const provider = fixture({
      issueSignedToken: async () => {
        throw new Error(`provider failed with ${token}`);
      },
    });
    await assert.rejects(storage(provider).mintDownload(path), (error: unknown) => {
      assert.ok(error instanceof ReviewStorageError);
      assert.equal(error.code, 'PROVIDER_ERROR');
      assert.doesNotMatch(error.message, /unit-test-token|provider failed/);
      return true;
    });
  });
});
