import Groq from 'groq-sdk';
import { MergedContent, VideoSummaryOutput, Chapter, KeyMoment, VisualHighlight } from '../types/video';

let _groq: Groq | null = null;
function getGroq(): Groq {
    if (!_groq) {
        _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return _groq;
}

/**
 * Fallback chain configuration (same pattern as existing chat summarization).
 */
const AI_PROVIDERS = [
    {
        name: 'groq-llama-3.3-70b',
        model: 'llama-3.3-70b-versatile',
        provider: 'groq' as const,
        maxInputTokens: 10000,
    },
    {
        name: 'groq-llama-3.1-8b',
        model: 'llama-3.1-8b-instant',
        provider: 'groq' as const,
        maxInputTokens: 20000,
    },
];

const VIDEO_SUMMARY_PROMPT = `You are a video content analyst. Analyze the following timestamped document that combines a video's audio transcript with visual content analysis. Generate a structured summary.

## Requirements

1. **Brief Summary**: 2-3 paragraph overview of the entire video content.

2. **Detailed Summary**: 4-6 paragraph comprehensive summary.

3. **Chapters**: Divide the video into logical chapters/sections. Each chapter should have:
   - A descriptive title
   - Start and end timestamps (in seconds)
   - A 1-2 sentence summary of what's covered

4. **Key Moments**: Identify the most important moments — decisions made, insights shared, action items mentioned, or important questions raised. Include timestamp in seconds.

5. **Visual Highlights**: Note any important visual elements — slides, diagrams, code shown, demos — with their timestamps and descriptions.

## Output Format

Respond ONLY with valid JSON (no markdown fencing):
{
  "briefSummary": "...",
  "detailedSummary": "...",
  "chapters": [
    {
      "title": "Introduction",
      "start_time": 0,
      "end_time": 120,
      "summary": "The speaker introduces..."
    }
  ],
  "keyMoments": [
    {
      "timestamp": 345,
      "description": "Speaker decides to use React over Vue because...",
      "type": "decision"
    }
  ],
  "visualHighlights": [
    {
      "timestamp": 60,
      "type": "slide",
      "description": "Architecture diagram showing microservices layout"
    }
  ]
}

Types for keyMoments.type: "decision" | "insight" | "action_item" | "question"
Types for visualHighlights.type: "slide" | "diagram" | "code" | "demo" | "whiteboard" | "screen_share"

## Video Content to Analyze

`;

/**
 * Smart truncation — preserve beginning (context) and end (latest content).
 */
function truncateForProvider(text: string, maxTokens: number): string {
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    const startRatio = 0.6;
    const endRatio = 0.4;
    const startChars = Math.floor(maxChars * startRatio);
    const endChars = Math.floor(maxChars * endRatio);

    return (
        text.slice(0, startChars) +
        '\n\n[... middle section truncated for length ...]\n\n' +
        text.slice(-endChars)
    );
}

/**
 * Generate video summary using the AI fallback chain.
 */
export async function generateVideoSummary(
    mergedContent: MergedContent
): Promise<VideoSummaryOutput> {
    let lastError: Error | null = null;

    for (const provider of AI_PROVIDERS) {
        try {
            console.log(`[Summary] Trying provider: ${provider.name}`);

            const truncatedContent = truncateForProvider(
                mergedContent.mergedDocument,
                provider.maxInputTokens
            );

            const fullPrompt = VIDEO_SUMMARY_PROMPT + truncatedContent;

            const response = await getGroq().chat.completions.create({
                model: provider.model,
                messages: [
                    {
                        role: 'user',
                        content: fullPrompt,
                    },
                ],
                max_tokens: 4000,
                temperature: 0.3,
            });

            const text = response.choices[0]?.message?.content || '';

            // Parse JSON response
            const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
            const parsed = JSON.parse(cleaned);

            console.log(`[Summary] Success with ${provider.name}`);

            return {
                briefSummary: parsed.briefSummary || '',
                detailedSummary: parsed.detailedSummary || '',
                chapters: (parsed.chapters || []) as Chapter[],
                keyMoments: (parsed.keyMoments || []) as KeyMoment[],
                visualHighlights: (parsed.visualHighlights || []) as VisualHighlight[],
                providerUsed: provider.name,
            };

        } catch (error: any) {
            console.error(`[Summary] ${provider.name} failed:`, error?.message || error);
            lastError = error;

            // Wait before trying next provider
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    throw lastError || new Error('All AI providers failed');
}
