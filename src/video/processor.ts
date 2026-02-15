import path from 'path';
import fs from 'fs';
import { downloadFromR2, deleteFromR2 } from './r2-client';
import { extractAudio, chunkAudio, probeVideo } from './audio-extractor';
import { extractKeyFrames } from './frame-extractor';
import { transcribeChunks } from './transcriber';
import { analyzeFrames } from './visual-analyzer';
import { mergeContent } from './content-merger';
import { generateVideoSummary } from './video-summarizer';
import { cleanupTempFiles } from './cleanup';
import { getSupabaseServiceClient } from '../utils/supabase-client';

const TEMP_DIR = process.env.VIDEO_TEMP_DIR || '/tmp/video-processing/jobs';

/**
 * Main processing pipeline. Runs asynchronously after upload completes.
 * Updates job status at each stage for frontend polling.
 */
export async function startProcessingPipeline(
    jobId: string,
    r2Key: string,
    userId: string
): Promise<void> {
    const supabase = getSupabaseServiceClient();
    const jobDir = path.join(TEMP_DIR, jobId);
    const startTime = Date.now();

    console.log(`[Pipeline][${jobId}] Starting for user=${userId}`);

    // Helper to update job status
    async function updateStatus(
        status: string,
        progressPercent: number,
        progressDetail: string
    ) {
        const { error } = await supabase.rpc('update_video_job_status', {
            p_job_id: jobId,
            p_status: status,
            p_progress_percent: progressPercent,
            p_progress_detail: progressDetail,
        });
        if (error) {
            console.error(`[Pipeline][${jobId}] Failed to update status to ${status}:`, error.message);
        }
        console.log(`[Pipeline][${jobId}] ${status}: ${progressDetail} (${progressPercent}%)`);
    }

    try {
        // Create temp directory for this job
        fs.mkdirSync(jobDir, { recursive: true });

        // ============================================
        // STAGE 1: Download video from R2
        // ============================================
        await updateStatus('processing', 5, 'Downloading video for processing...');
        const videoPath = path.join(jobDir, 'video.mp4');
        await downloadFromR2(r2Key, videoPath);

        // Probe video for metadata
        const videoInfo = await probeVideo(videoPath);
        const durationSeconds = videoInfo.duration;

        // Update job with duration
        await supabase
            .from('video_jobs')
            .update({ duration_seconds: durationSeconds })
            .eq('id', jobId);

        // ============================================
        // STAGE 2: Extract audio
        // ============================================
        await updateStatus('extracting_audio', 10, 'Extracting audio track...');
        const audioPath = path.join(jobDir, 'audio.wav');
        await extractAudio(videoPath, audioPath);

        // Chunk audio into ≤25MB segments
        const audioChunks = await chunkAudio(audioPath, jobDir);
        await updateStatus('extracting_audio', 15, `Audio split into ${audioChunks.length} chunks`);

        // ============================================
        // STAGE 3: Extract key frames
        // ============================================
        await updateStatus('extracting_audio', 20, 'Extracting key frames from video...');
        const framesDir = path.join(jobDir, 'frames');
        const frames = await extractKeyFrames(videoPath, framesDir, durationSeconds);
        await updateStatus('extracting_audio', 25, `Extracted ${frames.length} key frames`);

        // ============================================
        // STAGE 4: Transcribe audio
        // ============================================
        const transcriptionResult = await transcribeChunks(
            audioChunks,
            async (current, total) => {
                const percent = 25 + Math.round((current / total) * 30); // 25-55%
                await updateStatus('transcribing', percent, `Transcribing audio chunk ${current}/${total}`);
            }
        );

        // ============================================
        // STAGE 5: Analyze frames
        // ============================================
        const frameAnalysis = await analyzeFrames(
            frames,
            async (current, total) => {
                const percent = 55 + Math.round((current / total) * 25); // 55-80%
                await updateStatus('analyzing_frames', percent, `Analyzing frame ${current}/${total}`);
            }
        );

        // ============================================
        // STAGE 6: Merge content
        // ============================================
        await updateStatus('summarizing', 82, 'Merging transcript and visual analysis...');
        const mergedContent = mergeContent(
            transcriptionResult,
            frameAnalysis,
            durationSeconds
        );

        // ============================================
        // STAGE 7: Generate summary
        // ============================================
        await updateStatus('summarizing', 85, 'Generating summary with chapters...');
        const summaryOutput = await generateVideoSummary(mergedContent);
        await updateStatus('summarizing', 95, 'Saving results...');

        // ============================================
        // STAGE 8: Store results
        // ============================================
        const processingTime = (Date.now() - startTime) / 1000;

        const { error: insertError } = await supabase.from('video_results').insert({
            job_id: jobId,
            user_id: userId,
            brief_summary: summaryOutput.briefSummary,
            detailed_summary: summaryOutput.detailedSummary,
            chapters: summaryOutput.chapters,
            key_moments: summaryOutput.keyMoments,
            visual_highlights: summaryOutput.visualHighlights,
            transcript: transcriptionResult.segments,
            video_duration_seconds: durationSeconds,
            total_chapters: summaryOutput.chapters.length,
            total_key_moments: summaryOutput.keyMoments.length,
            ai_provider_used: summaryOutput.providerUsed,
            processing_time_seconds: processingTime,
        });

        if (insertError) {
            console.error(`[Pipeline][${jobId}] Failed to insert video_results:`, insertError.message);
        }

        // Increment video usage
        const { error: usageError } = await supabase.rpc('increment_video_usage', { p_user_id: userId });
        if (usageError) {
            console.error(`[Pipeline][${jobId}] Failed to increment usage for user ${userId}:`, usageError.message);
        }

        // ============================================
        // STAGE 9: Cleanup
        // ============================================
        await updateStatus('completed', 100, 'Video summary ready!');

        // Delete video from R2 (we only keep the summary)
        await deleteFromR2(r2Key).catch((e) =>
            console.error(`[Cleanup] Failed to delete R2 key ${r2Key}:`, e)
        );

        // Clean up temp files
        cleanupTempFiles(jobDir);

    } catch (error) {
        console.error(`[Pipeline][${jobId}] Failed:`, error);

        // Check if we should retry
        const { data: job } = await supabase
            .from('video_jobs')
            .select('retry_count, max_retries')
            .eq('id', jobId)
            .single();

        if (job && job.retry_count < job.max_retries) {
            // Increment retry count and requeue
            await supabase
                .from('video_jobs')
                .update({
                    retry_count: job.retry_count + 1,
                    status: 'processing',
                    error_message: null,
                })
                .eq('id', jobId);

            // Retry after a delay
            setTimeout(() => {
                startProcessingPipeline(jobId, r2Key, userId).catch(console.error);
            }, 5000 * (job.retry_count + 1));
        } else {
            await supabase.rpc('update_video_job_status', {
                p_job_id: jobId,
                p_status: 'failed',
                p_progress_percent: null,
                p_progress_detail: null,
                p_error_message: error instanceof Error ? error.message : 'Unknown processing error',
            });
        }

        // Clean up on failure
        cleanupTempFiles(path.join(TEMP_DIR, jobId));
    }
}
