import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { ScrapeResult } from '../types';
import * as path from 'path';
import * as fs from 'fs';

// Enable stealth mode to bypass Cloudflare and other bot detection
puppeteer.use(StealthPlugin());

export abstract class BaseScraper {
    protected browser: Browser | null = null;
    protected page: Page | null = null;

    abstract scrape(url: string): Promise<ScrapeResult>;

    protected async initBrowser(): Promise<void> {
        this.browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
            ],
        }) as unknown as Browser;
        this.page = await this.browser.newPage();

        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });

        // Set user agent
        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
    }

    protected async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    protected async waitForContent(selector: string, timeout = 30000): Promise<void> {
        if (!this.page) throw new Error('Browser not initialized');
        await this.page.waitForSelector(selector, { timeout });
    }

    /**
     * Save a debug screenshot when scraping fails.
     * Screenshots go to ./debug-screenshots/ (created automatically).
     */
    protected async saveDebugScreenshot(label: string): Promise<void> {
        if (!this.page) return;
        try {
            const dir = path.join(process.cwd(), 'debug-screenshots');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const filename = `${label}-${Date.now()}.png`;
            await this.page.screenshot({ path: path.join(dir, filename), fullPage: true });
            console.log(`[Debug] Screenshot saved: ${filename}`);
        } catch (err) {
            console.warn('[Debug] Could not save screenshot:', err);
        }
    }

    /**
     * Wait for Cloudflare challenge to resolve (if present).
     * Returns true if the page loaded successfully past the challenge.
     */
    protected async waitForCloudflare(timeout = 15000): Promise<boolean> {
        if (!this.page) return false;

        const start = Date.now();
        while (Date.now() - start < timeout) {
            const pageContent = await this.page.content();
            // Check if we're past the Cloudflare challenge
            if (
                !pageContent.includes('Verify you are human') &&
                !pageContent.includes('Performing security verification') &&
                !pageContent.includes('cf-challenge')
            ) {
                return true;
            }
            // Wait a bit and check again
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return false;
    }
}
