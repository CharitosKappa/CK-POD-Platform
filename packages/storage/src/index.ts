import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';

export type PrivateObjectKey = string;

export interface PutPrivateObjectInput {
  key: PrivateObjectKey;
  body: Uint8Array | AsyncIterable<Uint8Array>;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StoredPrivateObject {
  key: PrivateObjectKey;
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
}

export interface OpenedPrivateObject {
  key: PrivateObjectKey;
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  metadata: Record<string, string>;
}

/**
 * The only asset-storage contract exposed to application code. It has no
 * permanent public URL operation by design, protecting future production masters.
 */
export interface PrivateObjectStorage {
  put(input: PutPrivateObjectInput): Promise<void>;
  get(key: PrivateObjectKey): Promise<StoredPrivateObject | null>;
  open(key: PrivateObjectKey): Promise<OpenedPrivateObject | null>;
  exists(key: PrivateObjectKey): Promise<boolean>;
  delete(key: PrivateObjectKey): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error('Object keys must be non-empty relative paths without traversal segments.');
  }
}

/** Local/test adapter. Data is process-local and must never be selected in production. */
export class MemoryObjectStorage implements PrivateObjectStorage {
  private readonly objects = new Map<PrivateObjectKey, StoredPrivateObject>();

  async put(input: PutPrivateObjectInput): Promise<void> {
    assertSafeKey(input.key);
    const body = await collectBytes(input.body);
    this.objects.set(input.key, {
      key: input.key,
      body,
      contentType: input.contentType,
      metadata: { ...input.metadata },
    });
  }

  async open(key: PrivateObjectKey): Promise<OpenedPrivateObject | null> {
    const object = await this.get(key);
    if (!object) return null;
    return {
      key: object.key,
      body: bytesAsStream(object.body),
      contentType: object.contentType,
      metadata: object.metadata,
    };
  }

  async get(key: PrivateObjectKey): Promise<StoredPrivateObject | null> {
    assertSafeKey(key);
    const object = this.objects.get(key);

    return object
      ? {
          ...object,
          body: new Uint8Array(object.body),
          metadata: { ...object.metadata },
        }
      : null;
  }

  async exists(key: PrivateObjectKey): Promise<boolean> {
    assertSafeKey(key);
    return this.objects.has(key);
  }

  async delete(key: PrivateObjectKey): Promise<void> {
    assertSafeKey(key);
    this.objects.delete(key);
  }
}

export interface S3PrivateObjectStorageOptions {
  bucket: string;
  clientConfig: S3ClientConfig;
}

/** S3 and S3-compatible private bucket adapter; bucket policy remains private. */
export class S3PrivateObjectStorage implements PrivateObjectStorage {
  private readonly client: S3Client;

  public constructor(private readonly options: S3PrivateObjectStorageOptions) {
    this.client = new S3Client(options.clientConfig);
  }

  async put(input: PutPrivateObjectInput): Promise<void> {
    assertSafeKey(input.key);
    if (input.body instanceof Uint8Array) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
      return;
    }
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.options.bucket,
        Key: input.key,
        Body: Readable.from(input.body),
        ContentType: input.contentType,
        Metadata: input.metadata,
      },
    }).done();
  }

  async open(key: PrivateObjectKey): Promise<OpenedPrivateObject | null> {
    assertSafeKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!response.Body) return null;
      return {
        key,
        body: response.Body as AsyncIterable<Uint8Array>,
        contentType: response.ContentType ?? 'application/octet-stream',
        metadata: response.Metadata ?? {},
      };
    } catch (error) {
      if (isObjectNotFound(error)) return null;
      throw error;
    }
  }

  async get(key: PrivateObjectKey): Promise<StoredPrivateObject | null> {
    assertSafeKey(key);

    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );

      if (!response.Body) {
        return null;
      }

      return {
        key,
        body: await response.Body.transformToByteArray(),
        contentType: response.ContentType ?? 'application/octet-stream',
        metadata: response.Metadata ?? {},
      };
    } catch (error) {
      if (isObjectNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async exists(key: PrivateObjectKey): Promise<boolean> {
    assertSafeKey(key);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isObjectNotFound(error)) {
        return false;
      }

      throw error;
    }
  }

  async delete(key: PrivateObjectKey): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}

function isObjectNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

async function collectBytes(body: Uint8Array | AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function* bytesAsStream(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield new Uint8Array(body);
}
