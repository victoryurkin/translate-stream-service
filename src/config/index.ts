import config from 'config';

export default {
  get: (key: string): string | undefined => {
    if (key === 'server.port' && process.env.PORT) {
      return process.env.PORT;
    }
    if (key === 'logger.level' && process.env.LOG_LEVEL) {
      return process.env.LOG_LEVEL;
    }
    return config.get(key);
  },
};
