import { Router, Request, Response, NextFunction } from 'express';
import { ScraperFactory } from '../scrapers';
import { Platform } from '../types';

export const scrapeRouter = Router();

interface ScrapeRequestBody {
    url: string;
    platform: Platform;
}

scrapeRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { url, platform } = req.body as ScrapeRequestBody;

        if (!url || !platform) {
            res.status(400).json({
                success: false,
                error: 'URL and platform are required',
            });
            return;
        }

        const validPlatforms: Platform[] = ['chatgpt', 'claude', 'gemini'];
        if (!validPlatforms.includes(platform)) {
            res.status(400).json({
                success: false,
                error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`,
            });
            return;
        }

        console.log(`[Scraper] Scraping ${platform} URL: ${url}`);

        const scraper = ScraperFactory.create(platform);
        const result = await scraper.scrape(url);

        if (!result.success) {
            res.status(422).json({
                success: false,
                error: result.error || 'Failed to scrape content',
            });
            return;
        }

        res.json({
            success: true,
            data: {
                title: result.title,
                messages: result.messages,
            },
        });
    } catch (error) {
        next(error);
    }
});
