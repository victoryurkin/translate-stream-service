import express, { Application } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import config from '@app/config';
import { logger } from '@app/clients/logger';
import healthCheck from './healthcheck';

const app: Application = express();

// Allow/handle only JSON payloads
app.use(bodyParser.json({ limit: config.get('server.bodyLimit') }));
// Allow cross-origin support
app.use(cors());

// healthcheck endpoint
healthCheck(app);

// useRouter(app);

// Endpoint not found error handler
app.use('*', (req, res): void => {
  logger.info(`no matching path for ${req.originalUrl}`);
  res.status(404).json({ message: `No matching path for ${req.originalUrl}` });
});

export default app;
