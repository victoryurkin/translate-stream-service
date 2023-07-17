import express, { Application } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import config from '@app/config';
import { logger } from '@app/clients/logger';
import healthCheck from './healthcheck';

// Authentication
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Google API
import { SpeechClient } from '@google-cloud/speech';
import { v2 } from '@google-cloud/translate';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

initializeApp({
  projectId: config.get('firebase.projectId'),
});
const app: Application = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const speechClient = new SpeechClient();
const translateClient = new v2.Translate();
const textToSpeechClient = new TextToSpeechClient();

// Allow cross-origin support
app.use(cors());

app.get('/', (req, res) => {
  res.json({
    name: 'translate-stream-service',
  });
});

// healthcheck endpoint
healthCheck(app);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decodedToken = await getAuth().verifyIdToken(token);
    const uid = decodedToken.uid;
    logger.info(`Connected user: ${uid}`);
    next();
  } catch (error) {
    next(new Error('UNAUTHORIZED'));
  }
});

io.on('connection', (socket: Socket) => {
  try {
    // Get translation job properties
    const query = socket.handshake.query;
    const sourceLang = query.sourceLang as string;
    const targetLang = query.targetLang as string;
    if (!sourceLang || sourceLang === '' || !targetLang || targetLang === '') {
      throw new Error('Source and/or target languages were not provided');
    }
    logger.info(`User connected. Source language: ${sourceLang}, target language: ${targetLang}`);

    // Create Recognize Stream
    const recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 44100,
          languageCode: sourceLang,
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
      })
      .on('error', (error) => logger.error('Recognize Stream error: ', error))
      .on('data', (data) => {
        socket.emit('transcriptionData', data);
      });

    socket.on('audioData', (data) => {
      recognizeStream.write(data);
    });

    socket.on('emptyTranscription', () => {
      recognizeStream.end();
      recognizeStream.removeAllListeners();
      socket.disconnect(true);
    });

    // Stop recording
    socket.on('translate', async (data) => {
      // Stop Recognize Stream and remove all listeners
      recognizeStream.end();
      recognizeStream.removeAllListeners();

      // Translate recording
      const [translations] = await translateClient.translate(data.transcription, targetLang);
      const translationsArray = Array.isArray(translations) ? translations : [translations];
      const translation = translationsArray.join(' ');
      socket.emit('translationData', translation);

      // Create audio
      const [response] = await textToSpeechClient.synthesizeSpeech({
        input: { text: translation },
        voice: { languageCode: targetLang, ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'MP3' },
      });
      socket.emit('audioFile', response.audioContent);
    });

    socket.on('disconnect', () => {
      logger.info('user disconnected');
    });
  } catch (error) {
    logger.error(error);
    socket.disconnect(true);
  }
});

// useRouter(app);

// Endpoint not found error handler
app.use('*', (req, res): void => {
  logger.info(`no matching path for ${req.originalUrl}`);
  res.status(404).json({ message: `No matching path for ${req.originalUrl}` });
});

export default server;
