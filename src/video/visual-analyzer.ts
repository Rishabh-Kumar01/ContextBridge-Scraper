import Groq from 'groq-sdk';
import fs from 'fs';
import { FrameAnalysis } from '../types/video';

interface ExtractedFrame {
    index: number;
    timestamp: number;
    filePath: string;
}

let _groq: Groq | null = null;
function getGroq(): Groq {
    if (!_groq) {
        _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return _groq;
}

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

const FRAME_ANALYSIS_PROMPT = `Analyze this video frame. Respond in JSON format only (no markdown, no backticks):
{
  "description": "Brief description of what is shown in this frame",
  "contentType": "slide" | "diagram" | "code" | "demo" | "whiteboard" | "screen_share" | "speaker" | "general",
  "hasText": true/false,
  "detectedText": "any text visible on screen, or null if none",
  "isSignificant": true/false
}

"isSignificant" should be true if this frame shows something noteworthy: a new slide, diagram, important code, key visual. False for talking head shots or transitions.`;

/**
 * Analyze key frames using Groq Vision.
 * Sends frames one at a time with rate limiting.
 */
export async function analyzeFrames(
    frames: ExtractedFrame[],
    onProgress: (current: number, total: number) => Promise<void>
): Promise<FrameAnalysis[]> {
    const results: FrameAnalysis[] = [];

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        await onProgress(i + 1, frames.length);

        try {
            const imageBuffer = fs.readFileSync(frame.filePath);
            const base64Image = imageBuffer.toString('base64');

            const response = await getGroq().chat.completions.create({
                model: VISION_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`,
                                },
                            },
                            {
                                type: 'text',
                                text: FRAME_ANALYSIS_PROMPT,
                            },
                        ],
                    },
                ],
                max_tokens: 500,
                temperature: 0.1,
            });

            const text = response.choices[0]?.message?.content || '';

            // Parse JSON response
            let parsed: any;
            try {
                // Strip any markdown fencing
                const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
                parsed = JSON.parse(cleaned);
            } catch {
                // If JSON parsing fails, create a basic analysis
                parsed = {
                    description: text.slice(0, 200),
                    contentType: 'general',
                    hasText: false,
                    detectedText: null,
                    isSignificant: false,
                };
            }

            results.push({
                frameIndex: frame.index,
                timestamp: frame.timestamp,
                filePath: frame.filePath,
                description: parsed.description || '',
                contentType: parsed.contentType || 'general',
                hasText: parsed.hasText || false,
                detectedText: parsed.detectedText || null,
            });

            console.log(
                `[Vision] Frame ${i + 1}/${frames.length}: ` +
                `${parsed.contentType} (significant: ${parsed.isSignificant})`
            );

        } catch (error: any) {
            if (error?.status === 429) {
                console.log(`[Vision] Rate limited on frame ${i + 1}, waiting 30s...`);
                await delay(30000);
                i--;
                continue;
            }

            // Non-fatal: skip this frame
            console.error(`[Vision] Error on frame ${i + 1}:`, error?.message || error);
            results.push({
                frameIndex: frame.index,
                timestamp: frame.timestamp,
                filePath: frame.filePath,
                description: 'Frame analysis failed',
                contentType: 'general',
                hasText: false,
                detectedText: null,
            });
        }

        // Rate limit delay between frames
        if (i < frames.length - 1) {
            await delay(1500);
        }
    }

    return results;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
