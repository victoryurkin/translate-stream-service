/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Application } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import config from '@app/config';
import { logger } from '@app/clients/logger';
import healthCheck from './healthcheck';

import { SpeechClient } from '@google-cloud/speech';
import { v2 } from '@google-cloud/translate';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const speechClient = new SpeechClient();
const translateClient = new v2.Translate();
const textToSpeechClient = new TextToSpeechClient();

enum IncomingEvents {
  START_RECORDING = 'startRecording',
  AUDIO_DATA = 'audioData',
  STOP_RECORDING = 'stopRecording',
}

enum OutgoingEvents {
  TRANSCRIPTION_DATA = 'transcriptionData',
  TRANSCRIPTION_END = 'transcriptionEnd',
  TRANSLATION_DATA = 'translationData',
  AUDIO_FILE = 'audioFile',
}

interface TranscriptionData {
  results: [
    {
      alternatives: [
        {
          transcript: string;
        },
      ];
      languageCode: string;
    },
  ];
}

// Authentication
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp({
  projectId: config.get('firebase.projectId'),
});
const app: Application = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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
  // let currentJob: Job | undefined;

  let recognizeStream;
  let transcription;

  socket.on(IncomingEvents.START_RECORDING, (data: unknown) => {
    const languages = (data as { languages: string[] }).languages;
    recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          audioChannelCount: 1,
          sampleRateHertz: 44100,
          languageCode: languages[0],
          alternativeLanguageCodes: languages,
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
      })
      .on('error', (error) => logger.error('Recognize Stream error: ', error))
      .on('data', (data) => {
        try {
          const transcriptionData = data as TranscriptionData;
          transcription = transcriptionData;
          socket.emit(OutgoingEvents.TRANSCRIPTION_DATA, transcriptionData);
        } catch (error) {
          logger.error(`Error on transcription data received: ${JSON.stringify(error)}`);
        }
      })
      .on('finish', async () => {
        const transcript = transcription?.results[0]?.alternatives[0]?.transcript;
        if (transcript && transcript.trim() !== '') {
          socket.emit(OutgoingEvents.TRANSCRIPTION_END, transcription);

          // Translate recording
          const translationLanguage =
            transcription.results[0].languageCode === languages[0].toLowerCase()
              ? languages[1]
              : languages[0];
          const [translations] = await translateClient.translate(transcript, translationLanguage);
          const translationsArray = Array.isArray(translations) ? translations : [translations];
          const translation = translationsArray.join(' ');
          socket.emit(OutgoingEvents.TRANSLATION_DATA, translation);
          // Create audio
          const [response] = await textToSpeechClient.synthesizeSpeech({
            input: { text: translation },
            voice: { languageCode: translationLanguage },
            audioConfig: { audioEncoding: 'MP3' },
          });
          socket.emit(OutgoingEvents.AUDIO_FILE, response.audioContent);
          transcription = undefined;
        }
      });
  });

  socket.on(IncomingEvents.AUDIO_DATA, (data) => {
    recognizeStream.write(data);
  });

  socket.on(IncomingEvents.STOP_RECORDING, () => {
    setTimeout(() => {
      recognizeStream.end();
    }, 500);
  });

  socket.on('disconnect', () => {
    if (recognizeStream) {
      recognizeStream.end();
    }
    logger.info('User disconnected');
  });
});

// useRouter(app);

// Endpoint not found error handler
app.use('*', (req, res): void => {
  logger.info(`no matching path for ${req.originalUrl}`);
  res.status(404).json({ message: `No matching path for ${req.originalUrl}` });
});

export default server;
