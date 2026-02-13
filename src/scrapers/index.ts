import { Platform } from '../types';
import { BaseScraper } from './base-scraper';
import { ChatGPTScraper } from './chatgpt-scraper';
import { ClaudeScraper } from './claude-scraper';
import { GeminiScraper } from './gemini-scraper';

export class ScraperFactory {
    static create(platform: Platform): BaseScraper {
        switch (platform) {
            case 'chatgpt':
                return new ChatGPTScraper();
            case 'claude':
                return new ClaudeScraper();
            case 'gemini':
                return new GeminiScraper();
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }
}

export { BaseScraper, ChatGPTScraper, ClaudeScraper, GeminiScraper };
