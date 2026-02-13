import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

interface ExtractedFrame {
    index: number;
    timestamp: number;      // seconds
    filePath: string;
}

/**
 * Extract key frames from video for visual analysis.
 *
 * Strategy:
 * - For videos < 5 min: 1 frame every 15 seconds
 * - For videos 5-30 min: 1 frame every 30 seconds
 * - For videos 30-60 min: 1 frame every 45 seconds
 * - For videos > 60 min: 1 frame every 60 seconds
 *
 * Caps total frames at 200 to stay within Groq rate limits.
 */
export async function extractKeyFrames(
    videoPath: string,
    outputDir: string,
    durationSeconds: number
): Promise<ExtractedFrame[]> {
    fs.mkdirSync(outputDir, { recursive: true });

    // Determine interval based on video length
    let intervalSeconds: number;
    if (durationSeconds < 300) {
        intervalSeconds = 15;
    } else if (durationSeconds < 1800) {
        intervalSeconds = 30;
    } else if (durationSeconds < 3600) {
        intervalSeconds = 45;
    } else {
        intervalSeconds = 60;
    }

    // Cap at 200 frames max
    const maxFrames = 200;
    const estimatedFrames = Math.ceil(durationSeconds / intervalSeconds);
    if (estimatedFrames > maxFrames) {
        intervalSeconds = Math.ceil(durationSeconds / maxFrames);
    }

    const fps = 1 / intervalSeconds;

    return new Promise((resolve, reject) => {
        const frames: ExtractedFrame[] = [];

        ffmpeg(videoPath)
            .outputOptions([
                `-vf fps=${fps}`,
                '-q:v 5',                // JPEG quality (2=best, 31=worst)
                '-vframes ' + maxFrames, // Hard cap
            ])
            .output(path.join(outputDir, 'frame_%04d.jpg'))
            .on('end', () => {
                // Read extracted frames and build metadata
                const files = fs.readdirSync(outputDir)
                    .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
                    .sort();

                files.forEach((file, index) => {
                    frames.push({
                        index,
                        timestamp: index * intervalSeconds,
                        filePath: path.join(outputDir, file),
                    });
                });

                console.log(`[FFmpeg] Extracted ${frames.length} frames (every ${intervalSeconds}s)`);
                resolve(frames);
            })
            .on('error', (err) => {
                console.error('[FFmpeg] Frame extraction error:', err);
                reject(err);
            })
            .run();
    });
}
