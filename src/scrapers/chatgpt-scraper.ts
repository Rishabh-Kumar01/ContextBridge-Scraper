import { BaseScraper } from './base-scraper';
import { ScrapeResult } from '../types';

export class ChatGPTScraper extends BaseScraper {
    async scrape(url: string): Promise<ScrapeResult> {
        try {
            await this.initBrowser();

            if (!this.page) {
                return { success: false, error: 'Failed to initialize browser' };
            }

            console.log('[ChatGPT] Navigating to share URL...');
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Wait for conversation to load with multiple selector fallbacks
            console.log('[ChatGPT] Waiting for messages...');
            try {
                await this.page.waitForFunction(
                    () => {
                        // Try multiple selectors
                        return (
                            document.querySelectorAll('[data-message-author-role]').length > 0 ||
                            document.querySelectorAll('[data-testid*="conversation-turn"]').length > 0 ||
                            document.querySelectorAll('article').length > 0
                        );
                    },
                    { timeout: 30000 }
                );
            } catch {
                // If waiting fails, take a screenshot and try to extract anyway
                console.warn('[ChatGPT] Timeout waiting for selectors, attempting extraction anyway...');
                await this.saveDebugScreenshot('chatgpt-timeout');
            }

            // Extra settle time
            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = await this.page.evaluate(() => {
                const title = document.querySelector('title')?.textContent || null;
                const messages: { role: 'user' | 'assistant'; content: string }[] = [];

                // Strategy 1: data-message-author-role attribute
                const roleElements = document.querySelectorAll('[data-message-author-role]');
                if (roleElements.length > 0) {
                    roleElements.forEach((el) => {
                        const role = el.getAttribute('data-message-author-role') as 'user' | 'assistant';
                        const contentEl = el.querySelector('.markdown, .whitespace-pre-wrap, [class*="markdown"]');
                        const content = (contentEl || el).textContent?.trim() || '';
                        if (content) {
                            messages.push({ role, content });
                        }
                    });
                }

                // Strategy 2: conversation-turn test IDs
                if (messages.length === 0) {
                    const turns = document.querySelectorAll('[data-testid*="conversation-turn"]');
                    turns.forEach((turn) => {
                        const isUser = turn.querySelector('[data-message-author-role="user"]') !== null;
                        const contentEl = turn.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]');
                        const content = (contentEl || turn).textContent?.trim() || '';
                        if (content && content.length > 2) {
                            messages.push({ role: isUser ? 'user' : 'assistant', content });
                        }
                    });
                }

                // Strategy 3: article elements (newer ChatGPT UI)
                if (messages.length === 0) {
                    const articles = document.querySelectorAll('article');
                    articles.forEach((article, index) => {
                        const content = article.textContent?.trim() || '';
                        if (content && content.length > 2) {
                            messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content });
                        }
                    });
                }

                return { title, messages };
            });

            await this.closeBrowser();

            if (result.messages.length === 0) {
                return { success: false, error: 'No messages found on ChatGPT share page' };
            }

            console.log(`[ChatGPT] Extracted ${result.messages.length} messages`);
            return {
                success: true,
                title: result.title,
                messages: result.messages,
            };
        } catch (error) {
            await this.saveDebugScreenshot('chatgpt-error');
            await this.closeBrowser();
            console.error('ChatGPT scraping error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
