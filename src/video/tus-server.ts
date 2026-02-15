import { Server as TusServer, Upload } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { MemoryLocker } from '@tus/server';
import path from 'path';
import fs from 'fs';
import { uploadToR2 } from './r2-client';
import { startProcessingPipeline } from './processor';
import { getSupabaseServiceClient } from '../utils/supabase-client';

const UPLOAD_DIR = process.env.TUS_UPLOAD_DIR || '/tmp/video-processing/uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const tusServer = new TusServer({
    path: '/upload',
    datastore: new FileStore({ directory: UPLOAD_DIR }),
    locker: new MemoryLocker(),
    respectForwardedHeaders: true,

    // Explicitly construct the upload URL using proxy headers.
    // This ensures https:// is used when behind Render's reverse proxy,
    // preventing mixed-content errors on the frontend.
    generateUrl(req, { proto, host, path, id }) {
        const actualProto = req.headers.get('x-forwarded-proto') || proto;
        const actualHost = req.headers.get('x-forwarded-host') || host;
        return `${actualProto}://${actualHost}${path}/${id}`;
    },

    // Called when upload completes
    async onUploadFinish(req, upload) {
        const metadata = upload.metadata;
        if (!metadata) {
            console.error('[TUS] No metadata on completed upload');
            return {};
        }

        const jobId = metadata.jobId;
        const userId = metadata.userId;
        const filename = metadata.filename || 'video.mp4';
        const filetype = metadata.filetype || 'video/mp4';

        console.log(`[TUS] Upload complete: job=${jobId}, user=${userId}, file=${filename}`);

        try {
            // 1. Upload assembled file to R2
            const localPath = path.join(UPLOAD_DIR, upload.id);
            const r2Key = `uploads/${jobId}/${filename}`;

            await uploadToR2(localPath, r2Key, filetype);

            // 2. Update job in Supabase
            const supabase = getSupabaseServiceClient();
            await supabase
                .from('video_jobs')
                .update({
                    r2_key: r2Key,
                    tus_upload_id: upload.id,
                    status: 'processing',
                    upload_completed_at: new Date().toISOString(),
                })
                .eq('id', jobId);

            // 3. Delete local file (free up disk)
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }
            // Also clean up the .info file tus creates
            const infoPath = `${localPath}.info`;
            if (fs.existsSync(infoPath)) {
                fs.unlinkSync(infoPath);
            }

            // 4. Start async processing pipeline (fire and forget)
            startProcessingPipeline(jobId!, r2Key, userId || '').catch((error) => {
                console.error(`[Pipeline] Fatal error for job ${jobId}:`, error);
            });

        } catch (error) {
            console.error(`[TUS] Post-upload error for job ${jobId}:`, error);

            // Mark job as failed
            const supabase = getSupabaseServiceClient();
            await supabase
                .from('video_jobs')
                .update({
                    status: 'failed',
                    error_message: 'Failed to process uploaded file',
                })
                .eq('id', jobId);
        }

        return {};
    },
});