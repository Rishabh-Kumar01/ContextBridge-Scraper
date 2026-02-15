import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { scrapeRouter } from './routes/scrape';
import { healthRouter } from './routes/health';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { tusServer } from './video/tus-server';

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/scrape', authMiddleware, scrapeRouter);

// NEW: TUS upload endpoint
// The tus protocol uses its own request handling, so we mount it directly
const uploadApp = express();
uploadApp.all('*', (req, res) => {
    tusServer.handle(req, res);
});
app.use('/upload', uploadApp);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Scraper + Video service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API_KEY configured: ${!!process.env.API_KEY}`);
});
