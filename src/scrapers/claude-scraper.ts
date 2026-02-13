import { BaseScraper } from './base-scraper';
import { ScrapeResult } from '../types';

export class ClaudeScraper extends BaseScraper {
    async scrape(url: string): Promise<ScrapeResult> {
        try {
            await this.initBrowser();

            if (!this.page) {
                return { success: false, error: 'Failed to initialize browser' };
            }

            console.log('[Claude] Navigating to share URL...');
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Wait for Cloudflare challenge to resolve (if present)
            console.log('[Claude] Checking for Cloudflare challenge...');
            const passedCloudflare = await this.waitForCloudflare(20000);
            if (!passedCloudflare) {
                await this.saveDebugScreenshot('claude-cloudflare-blocked');
                console.warn('[Claude] Cloudflare challenge still present after waiting');
            }

            // Give the page extra time to render client-side content
            console.log('[Claude] Waiting for page content to render...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Take a debug screenshot
            await this.saveDebugScreenshot('claude-loaded');

            // Extract conversation data using simple querySelectorAll
            // (avoid TreeWalker with acceptNode object — tsx/esbuild injects __name 
            //  which doesn't exist in the browser evaluate context)
            const result = await this.page.evaluate(() => {
                var title = document.querySelector('title')?.textContent || null;
                var messages: { role: 'user' | 'assistant'; content: string }[] = [];

                // Grab all block-level text elements from the page
                var selector = 'p, pre, h1, h2, h3, h4, h5, h6, li, blockquote, td';
                var mainContent = document.querySelector('main') || document.body;
                var elements = mainContent.querySelectorAll(selector);

                var textBlocks: string[] = [];
                for (var i = 0; i < elements.length; i++) {
                    var text = elements[i].textContent?.trim() || '';
                    if (text.length > 3 && textBlocks.indexOf(text) === -1) {
                        textBlocks.push(text);
                    }
                }

                // Return all extracted text as a single message
                if (textBlocks.length > 0) {
                    var fullText = textBlocks.join('\n\n');
                    messages.push({ role: 'assistant', content: fullText });
                }

                return {
                    title: title,
                    messages: messages,
                    blockCount: textBlocks.length,
                    bodyLen: document.body.innerText.length
                };
            });

            await this.closeBrowser();

            console.log('[Claude] Debug: ' + result.blockCount + ' text blocks, body length: ' + result.bodyLen);

            if (result.messages.length === 0) {
                return { success: false, error: 'No messages found on Claude share page.' };
            }

            console.log('[Claude] Extracted ' + result.messages.length + ' message(s)');
            return {
                success: true,
                title: result.title,
                messages: result.messages,
            };
        } catch (error) {
            await this.saveDebugScreenshot('claude-error');
            await this.closeBrowser();
            console.error('Claude scraping error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
