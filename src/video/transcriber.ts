import Groq from 'groq-sdk';
import fs from 'fs';
import { AudioChunk, TranscriptionResult, TranscriptSegment } from '../types/video';

let _groq: Groq | null = null;
function getGroq(): Groq {
    if (!_groq) {
        _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return _groq;
}

/**
 * Transcribe all audio chunks using Groq Whisper.
 * Handles rate limiting and connection errors with exponential backoff.
 */
export async function transcribeChunks(
    chunks: AudioChunk[],
    onProgress: (current: number, total: number) => Promise<void>
): Promise<TranscriptionResult> {
    const allSegments: TranscriptSegment[] = [];
    let fullText = '';
    let detectedLanguage = 'en';

    const MAX_RETRIES = 5;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await onProgress(i + 1, chunks.length);

        let retries = 0;
        let success = false;

        while (!success && retries <= MAX_RETRIES) {
            try {
                const file = fs.createReadStream(chunk.filePath);

                const transcription = await getGroq().audio.transcriptions.create({
                    file: file,
                    model: 'whisper-large-v3-turbo',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment'],
                    language: 'en',
                    temperature: 0.0,
                });

                // Offset timestamps by chunk start time
                if ((transcription as any).segments) {
                    for (const segment of (transcription as any).segments) {
                        allSegments.push({
                            start: segment.start + chunk.startTime,
                            end: segment.end + chunk.startTime,
                            text: segment.text.trim(),
                        });
                    }
                }

                fullText += (transcription.text || '') + ' ';
                if ((transcription as any).language) {
                    detectedLanguage = (transcription as any).language;
                }

                console.log(
                    `[Whisper] Chunk ${i + 1}/${chunks.length}: ` +
                    `${(transcription as any).segments?.length || 0} segments`
                );

                success = true;

            } catch (error: any) {
                retries++;
                const isRateLimit = error?.status === 429;
                const isConnectionError = error?.cause?.code === 'ECONNRESET'
                    || error?.cause?.code === 'ETIMEDOUT'
                    || error?.cause?.code === 'ENOTFOUND'
                    || error?.message?.includes('Connection error');

                if ((isRateLimit || isConnectionError) && retries <= MAX_RETRIES) {
                    // Exponential backoff: 15s, 30s, 60s, 120s, 240s
                    const backoffMs = Math.min(15000 * Math.pow(2, retries - 1), 240000);
                    const reason = isRateLimit ? 'rate limited' : 'connection error';
                    console.log(
                        `[Whisper] ${reason} on chunk ${i + 1}, ` +
                        `retry ${retries}/${MAX_RETRIES}, waiting ${backoffMs / 1000}s...`
                    );
                    await delay(backoffMs);
                    continue;
                }

                console.error(`[Whisper] Failed on chunk ${i + 1} after ${retries} retries:`, error.message || error);
                throw error;
            }
        }

        // Small delay between chunks to respect rate limits
        if (i < chunks.length - 1) {
            await delay(2000);
        }
    }

    const totalDuration = allSegments.length > 0
        ? allSegments[allSegments.length - 1].end
        : 0;

    return {
        segments: allSegments,
        fullText: fullText.trim(),
        language: detectedLanguage,
        duration: totalDuration,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
