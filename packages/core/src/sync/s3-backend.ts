/**
 * S3-compatible sync backend implementation.
 * Supports AWS S3, Cloudflare R2, Alibaba OSS, Tencent COS, MinIO, etc.
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ISyncBackend, RemoteFile, S3Config } from "./sync-backend";

/**
 * S3 backend implementation.
 * Works with any S3-compatible storage service.
 */
export class S3Backend implements ISyncBackend {
  readonly type = "s3" as const;
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config, secretAccessKey: string) {
    this.config = config;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: config.pathStyle ?? false,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: 1,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async ensureDirectories(): Promise<void> {
    // S3 doesn't have directories, but we create placeholder objects
    // to ensure the bucket is accessible
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: 1,
          Prefix: "readany/",
        }),
      );
    } catch (e) {
      const error = e as { name?: string };
      // If bucket doesn't exist, try to create it
      if (error.name === "NoSuchBucket") {
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.config.bucket,
          }),
        );
      } else {
        throw e;
      }
    }
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const key = this.normalizePath(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
      }),
    );
  }

  async get(path: string): Promise<Uint8Array> {
    const key = this.normalizePath(path);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) {
      throw new Error(`Empty response body for ${path}`);
    }
    return body;
  }

  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as T;
    } catch (e) {
      const error = e as { name?: string };
      if (error.name === "NoSuchKey" || error.name === "NotFound") {
        return null;
      }
      throw e;
    }
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    const json = JSON.stringify(data);
    await this.put(path, new TextEncoder().encode(json));
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const prefix = this.normalizePath(path);
    const files: RemoteFile[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of response.Contents ?? []) {
        if (!object.Key) continue;
        // Skip the directory itself
        if (object.Key === prefix || object.Key === prefix + "/") continue;

        const name = object.Key.split("/").pop() || object.Key;
        files.push({
          name,
          path: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified?.getTime() ?? 0,
          isDirectory: object.Key.endsWith("/"),
        });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  async delete(path: string): Promise<void> {
    const key = this.normalizePath(path);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async exists(path: string): Promise<boolean> {
    const key = this.normalizePath(path);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getDisplayName(): Promise<string> {
    const url = new URL(this.config.endpoint);
    return `S3 (${this.config.bucket} @ ${url.host})`;
  }

  /**
   * Normalize path for S3 key.
   * Removes leading slash and ensures consistent format.
   */
  private normalizePath(path: string): string {
    // Remove leading slash and "readany" prefix if present
    let normalized = path.replace(/^\//, "");
    if (!normalized.startsWith("readany/")) {
      normalized = `readany/${normalized}`;
    }
    return normalized;
  }
}

/**
 * Create an S3 backend from configuration.
 */
export function createS3Backend(config: S3Config, secretAccessKey: string): S3Backend {
  return new S3Backend(config, secretAccessKey);
}
