// ============================================
// VIDEO PROCESSING PIPELINE TYPES
// ============================================

export type VideoJobStatus =
    | 'uploading'
    | 'processing'
    | 'extracting_audio'
    | 'transcribing'
    | 'analyzing_frames'
    | 'summarizing'
    | 'completed'
    | 'failed';

export interface AudioChunk {
    index: number;
    filePath: string;
    startTime: number;        // seconds offset in original video
    duration: number;         // seconds
    sizeBytes: number;
}

export interface TranscriptSegment {
    start: number;            // seconds
    end: number;              // seconds
    text: string;
}

export interface TranscriptionResult {
    segments: TranscriptSegment[];
    fullText: string;
    language: string;
    duration: number;
}

export interface FrameAnalysis {
    frameIndex: number;
    timestamp: number;        // seconds
    filePath: string;
    description: string;
    contentType: 'slide' | 'diagram' | 'code' | 'demo' | 'whiteboard' | 'screen_share' | 'speaker' | 'general';
    hasText: boolean;
    detectedText: string | null;
}

export interface MergedContent {
    transcript: TranscriptSegment[];
    visualAnalysis: FrameAnalysis[];
    duration: number;
    mergedDocument: string;   // Combined text for summarization
}

export interface Chapter {
    title: string;
    start_time: number;      // seconds from start
    end_time: number;         // seconds from start
    summary: string;
}

export interface KeyMoment {
    timestamp: number;        // seconds from start
    description: string;
    type: 'decision' | 'insight' | 'action_item' | 'question';
}

export interface VisualHighlight {
    timestamp: number;        // seconds from start
    type: 'slide' | 'diagram' | 'code' | 'demo' | 'whiteboard' | 'screen_share';
    description: string;
}

export interface VideoSummaryOutput {
    briefSummary: string;
    detailedSummary: string;
    chapters: Chapter[];
    keyMoments: KeyMoment[];
    visualHighlights: VisualHighlight[];
    providerUsed: string;
}
