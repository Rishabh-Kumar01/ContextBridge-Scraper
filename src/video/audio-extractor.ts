import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { AudioChunk } from '../types/video';

interface VideoProbeResult {
    duration: number;       // seconds
    width: number;
    height: number;
    fps: number;
    audioCodec: string | null;
    hasAudio: boolean;
}

/**
 * Probe video file for metadata
 */
export function probeVideo(videoPath: string): Promise<VideoProbeResult> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);

            const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
            const audioStream = metadata.streams.find((s) => s.codec_type === 'audio');

            const fpsStr = videoStream?.r_frame_rate || '30/1';
            const fpsParts = fpsStr.split('/');
            const fps = fpsParts.length === 2
                ? Number(fpsParts[0]) / Number(fpsParts[1])
                : Number(fpsStr) || 30;

            resolve({
                duration: metadata.format.duration || 0,
                width: videoStream?.width || 0,
                height: videoStream?.height || 0,
                fps,
                audioCodec: audioStream?.codec_name || null,
                hasAudio: !!audioStream,
            });
        });
    });
}

/**
 * Extract audio track from video as WAV (16kHz mono — optimal for Whisper)
 */
export function extractAudio(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .noVideo()
            .audioFrequency(16000)
            .audioChannels(1)
            .audioCodec('pcm_s16le')
            .format('wav')
            .output(outputPath)
            .on('end', () => {
                console.log(`[FFmpeg] Audio extracted: ${outputPath}`);
                resolve();
            })
            .on('error', (err) => {
                console.error('[FFmpeg] Audio extraction error:', err);
                reject(err);
            })
            .run();
    });
}

/**
 * Split audio into chunks that fit within Groq Whisper's 25MB free tier limit.
 *
 * 16kHz mono 16-bit WAV = ~32KB/second = ~1.9MB/minute
 * 25MB limit ≈ 13 minutes per chunk (with safety margin, use 10 minutes)
 */
export async function chunkAudio(
    audioPath: string,
    outputDir: string
): Promise<AudioChunk[]> {
    const CHUNK_DURATION_SECONDS = 600; // 10 minutes per chunk
    const audioSize = fs.statSync(audioPath).size;

    // If file is small enough, return as single chunk
    if (audioSize <= 24 * 1024 * 1024) {
        return [
            {
                index: 0,
                filePath: audioPath,
                startTime: 0,
                duration: 0, // Will be filled by Whisper
                sizeBytes: audioSize,
            },
        ];
    }

    // Probe to get total duration
    const probe = await probeVideo(audioPath);
    const totalDuration = probe.duration;
    const numChunks = Math.ceil(totalDuration / CHUNK_DURATION_SECONDS);
    const chunks: AudioChunk[] = [];

    const chunksDir = path.join(outputDir, 'audio_chunks');
    fs.mkdirSync(chunksDir, { recursive: true });

    for (let i = 0; i < numChunks; i++) {
        const startTime = i * CHUNK_DURATION_SECONDS;
        const chunkPath = path.join(chunksDir, `chunk_${String(i).padStart(3, '0')}.wav`);

        await new Promise<void>((resolve, reject) => {
            ffmpeg(audioPath)
                .setStartTime(startTime)
                .duration(CHUNK_DURATION_SECONDS)
                .audioFrequency(16000)
                .audioChannels(1)
                .audioCodec('pcm_s16le')
                .format('wav')
                .output(chunkPath)
                .on('end', () => resolve())
                .on('error', (err: Error) => reject(err))
                .run();
        });

        const chunkSize = fs.statSync(chunkPath).size;
        chunks.push({
            index: i,
            filePath: chunkPath,
            startTime,
            duration: Math.min(CHUNK_DURATION_SECONDS, totalDuration - startTime),
            sizeBytes: chunkSize,
        });

        console.log(`[FFmpeg] Audio chunk ${i + 1}/${numChunks}: ${(chunkSize / 1024 / 1024).toFixed(1)} MB`);
    }

    return chunks;
}
