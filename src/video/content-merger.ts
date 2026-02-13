import {
    TranscriptionResult,
    FrameAnalysis,
    MergedContent,
    TranscriptSegment,
} from '../types/video';

/**
 * Merge timestamped transcript and visual analysis into a unified document
 * that can be fed to the summarization AI.
 */
export function mergeContent(
    transcription: TranscriptionResult,
    frameAnalysis: FrameAnalysis[],
    totalDuration: number
): MergedContent {
    // Filter to only significant visual frames
    const significantFrames = frameAnalysis.filter(
        (f) => f.contentType !== 'general' || f.hasText
    );

    // Build a chronological merged document
    let mergedDocument = '';

    mergedDocument += `# Video Analysis Document\n\n`;
    mergedDocument += `Total Duration: ${formatTimestamp(totalDuration)}\n`;
    mergedDocument += `Transcript Segments: ${transcription.segments.length}\n`;
    mergedDocument += `Visual Elements Detected: ${significantFrames.length}\n\n`;
    mergedDocument += `---\n\n`;

    // Create time-ordered events from both sources
    interface TimeEvent {
        timestamp: number;
        type: 'speech' | 'visual';
        content: string;
    }

    const events: TimeEvent[] = [];

    // Add transcript segments (group into ~30 second blocks for readability)
    const BLOCK_DURATION = 30;
    let currentBlock: TranscriptSegment[] = [];
    let blockStartTime = 0;

    for (const segment of transcription.segments) {
        if (segment.start - blockStartTime > BLOCK_DURATION && currentBlock.length > 0) {
            // Flush current block
            const blockText = currentBlock.map((s) => s.text).join(' ');
            events.push({
                timestamp: blockStartTime,
                type: 'speech',
                content: blockText,
            });
            currentBlock = [segment];
            blockStartTime = segment.start;
        } else {
            if (currentBlock.length === 0) blockStartTime = segment.start;
            currentBlock.push(segment);
        }
    }

    // Flush remaining block
    if (currentBlock.length > 0) {
        const blockText = currentBlock.map((s) => s.text).join(' ');
        events.push({
            timestamp: blockStartTime,
            type: 'speech',
            content: blockText,
        });
    }

    // Add visual events
    for (const frame of significantFrames) {
        let visualDesc = `[VISUAL: ${frame.contentType.toUpperCase()}] ${frame.description}`;
        if (frame.hasText && frame.detectedText) {
            visualDesc += ` | On-screen text: "${frame.detectedText}"`;
        }
        events.push({
            timestamp: frame.timestamp,
            type: 'visual',
            content: visualDesc,
        });
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Build the document
    for (const event of events) {
        const ts = formatTimestamp(event.timestamp);
        if (event.type === 'speech') {
            mergedDocument += `[${ts}] SPEECH: ${event.content}\n\n`;
        } else {
            mergedDocument += `[${ts}] ${event.content}\n\n`;
        }
    }

    return {
        transcript: transcription.segments,
        visualAnalysis: frameAnalysis,
        duration: totalDuration,
        mergedDocument,
    };
}

function formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}
