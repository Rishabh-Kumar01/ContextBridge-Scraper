import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'contextbridge-videos';

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

/**
 * Upload a file to R2
 * @param filePath Local file path
 * @param key R2 object key (e.g., "uploads/{userId}/{jobId}/video.mp4")
 * @param contentType MIME type
 */
export async function uploadToR2(
    filePath: string,
    key: string,
    contentType: string
): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;

    await r2Client.send(
        new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: fileStream,
            ContentType: contentType,
            ContentLength: fileSize,
        })
    );

    console.log(`[R2] Uploaded ${key} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
}

/**
 * Download a file from R2 to local path
 */
export async function downloadFromR2(
    key: string,
    localPath: string
): Promise<void> {
    const response = await r2Client.send(
        new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
        })
    );

    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(localPath);
    const body = response.Body as Readable;
    body.pipe(writeStream);

    return new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
}

/**
 * Delete a file from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
    await r2Client.send(
        new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
        })
    );
    console.log(`[R2] Deleted ${key}`);
}

/**
 * Generate a pre-signed URL for direct upload (alternative to tus)
 */
export async function getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number = 3600
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });

    return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

export { r2Client, R2_BUCKET_NAME };
