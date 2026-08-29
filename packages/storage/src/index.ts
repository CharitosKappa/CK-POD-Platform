import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export type PrivateObjectKey = string;

export interface PutPrivateObjectInput {
  key: PrivateObjectKey;
  body: Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StoredPrivateObject {
  key: PrivateObjectKey;
  body: Uint8Array;
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
    this.objects.set(input.key, {
      key: input.key,
      body: new Uint8Array(input.body),
      contentType: input.contentType,
      metadata: { ...input.metadata },
    });
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
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
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
