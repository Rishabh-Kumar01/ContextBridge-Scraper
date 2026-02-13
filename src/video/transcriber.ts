import Groq from 'groq-sdk';
import fs from 'fs';
import { AudioChunk, TranscriptionResult, TranscriptSegment } from '../types/video';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Transcribe all audio chunks using Groq Whisper.
 * Handles rate limiting with delays between requests.
 */
export async function transcribeChunks(
    chunks: AudioChunk[],
    onProgress: (current: number, total: number) => Promise<void>
): Promise<TranscriptionResult> {
    const allSegments: TranscriptSegment[] = [];
    let fullText = '';
    let detectedLanguage = 'en';

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await onProgress(i + 1, chunks.length);

        try {
            const file = fs.createReadStream(chunk.filePath);

            const transcription = await groq.audio.transcriptions.create({
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

        } catch (error: any) {
            // Handle rate limiting — wait and retry
            if (error?.status === 429) {
                console.log(`[Whisper] Rate limited on chunk ${i + 1}, waiting 30s...`);
                await delay(30000);
                i--; // Retry this chunk
                continue;
            }
            console.error(`[Whisper] Error on chunk ${i + 1}:`, error);
            throw error;
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
