import config from '@app/config';
import server from '@app/app';
import { logger } from '@app/clients/logger';

if (process.env.NODE_ENV === 'dev') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
}

process.on('uncaughtException', (err) => {
  logger.error('Unhandled Exception', err);
});

process.on('uncaughtRejection', (err) => {
  logger.error('Unhandled Rejection', err);
});

// Output environment variables
logger.info(`Environment: ${process.env.NODE_ENV}`);

// starting the server
server
  .listen(config.get('server.port'), () => {
    logger.info(`Listening on port ${config.get('server.port')}`);
  })
  .setTimeout(
    config.get('server.timeout') ? parseInt(config.get('server.timeout') || '', 10) : 60000,
  );
