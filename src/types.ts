export type Platform = 'chatgpt' | 'claude' | 'gemini';

export interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export interface ScrapeResult {
    success: boolean;
    title?: string | null;
    messages?: Message[];
    error?: string;
}
