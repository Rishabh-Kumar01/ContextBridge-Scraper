import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string;
    const expectedKey = process.env.API_KEY;

    if (!expectedKey) {
        console.warn('[Auth] API_KEY not configured - allowing all requests');
        next();
        return;
    }

    if (!apiKey || apiKey !== expectedKey) {
        res.status(401).json({
            success: false,
            error: 'Unauthorized - missing or invalid API key',
        });
        return;
    }

    next();
}
