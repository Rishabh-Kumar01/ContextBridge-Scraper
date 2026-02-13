import { BaseScraper } from './base-scraper';
import { ScrapeResult } from '../types';

export class GeminiScraper extends BaseScraper {
    async scrape(url: string): Promise<ScrapeResult> {
        try {
            await this.initBrowser();

            if (!this.page) {
                return { success: false, error: 'Failed to initialize browser' };
            }

            console.log('[Gemini] Navigating to share URL...');
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Wait for content with fallback
            console.log('[Gemini] Waiting for messages...');
            try {
                await this.page.waitForFunction(
                    () => {
                        const candidates = document.querySelectorAll(
                            '[class*="message"], [class*="response"], [class*="query"], [class*="turn"], [class*="conversation"]'
                        );
                        return candidates.length > 0;
                    },
                    { timeout: 30000 }
                );
            } catch {
                console.warn('[Gemini] Timeout waiting for selectors, attempting extraction anyway...');
                await this.saveDebugScreenshot('gemini-timeout');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = await this.page.evaluate(() => {
                const title = document.querySelector('title')?.textContent || null;
                const messages: { role: 'user' | 'assistant'; content: string }[] = [];

                // Strategy 1: Look for conversation turns
                const turns = document.querySelectorAll('[class*="conversation-turn"], [class*="turn"]');
                if (turns.length > 0) {
                    turns.forEach((turn) => {
                        const userContent = turn.querySelector('[class*="user"], [class*="query"]')?.textContent?.trim();
                        const assistantContent = turn.querySelector('[class*="model"], [class*="response"]')?.textContent?.trim();

                        if (userContent) messages.push({ role: 'user', content: userContent });
                        if (assistantContent) messages.push({ role: 'assistant', content: assistantContent });
                    });
                }

                // Strategy 2: Separate query and response elements
                if (messages.length === 0) {
                    const userQueries = document.querySelectorAll('[class*="query-text"], [class*="user-message"], [class*="query"]');
                    const modelResponses = document.querySelectorAll('[class*="response-text"], [class*="model-response"], [class*="response"]');

                    const maxLen = Math.max(userQueries.length, modelResponses.length);
                    for (let i = 0; i < maxLen; i++) {
                        if (i < userQueries.length) {
                            const content = userQueries[i].textContent?.trim();
                            if (content && content.length > 2) messages.push({ role: 'user', content });
                        }
                        if (i < modelResponses.length) {
                            const content = modelResponses[i].textContent?.trim();
                            if (content && content.length > 2) messages.push({ role: 'assistant', content });
                        }
                    }
                }

                // Strategy 3: Markdown/prose blocks
                if (messages.length === 0) {
                    const proseBlocks = document.querySelectorAll('[class*="markdown"], [class*="prose"]');
                    proseBlocks.forEach((el, index) => {
                        const content = el.textContent?.trim() || '';
                        if (content && content.length > 5) {
                            messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content });
                        }
                    });
                }

                return { title, messages };
            });

            await this.closeBrowser();

            if (result.messages.length === 0) {
                return { success: false, error: 'No messages found on Gemini share page' };
            }

            console.log(`[Gemini] Extracted ${result.messages.length} messages`);
            return {
                success: true,
                title: result.title,
                messages: result.messages,
            };
        } catch (error) {
            await this.saveDebugScreenshot('gemini-error');
            await this.closeBrowser();
            console.error('Gemini scraping error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
