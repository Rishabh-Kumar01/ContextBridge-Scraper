import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { scrapeRouter } from './routes/scrape';
import { healthRouter } from './routes/health';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/scrape', authMiddleware, scrapeRouter);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Scraper service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API_KEY configured: ${!!process.env.API_KEY}`);
});
