import { createLogger, format, transports } from 'winston';
import config from '@app/config';

export const logger = createLogger({
  level: config.get('logger.level') || 'info', // default to info level
  exitOnError: false,
  format: format.json(),
  transports: [
    new transports.Console({
      format: format.simple(),
    }),
  ],
});
