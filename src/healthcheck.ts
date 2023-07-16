import { Application } from 'express';

const healthCheck = (app: Application): void => {
  app.get('/healthcheck', async (_, res) => {
    const successBody = {
      success: true,
      status: 'healthy',
    };
    res.status(200).json(successBody).end();
  });
};

export default healthCheck;
