/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Google Clients
import { SpeechClient } from '@google-cloud/speech';
import { v2 } from '@google-cloud/translate';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

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
      isFinal: boolean;
      languageCode: string;
    },
  ];
}

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
  let recognizeStream: any = null;
  let transcripts: string[] = [];

  socket.on(IncomingEvents.START_RECORDING, (data: unknown) => {
    console.log('startRecording ', data);
    const recordingData = data as { sourceLanguage: string; targetLanguage: string };
    transcripts = [];
    recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: recordingData.sourceLanguage,
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
      })
      .on('error', (error) => console.error('stream error: ', error))
      .on('data', (data: TranscriptionData) => {
        if (transcripts.length === 0) {
          transcripts.push(data.results[0].alternatives[0].transcript);
        } else {
          transcripts[transcripts.length - 1] = data.results[0].alternatives[0].transcript;
        }
        if (data.results[0].isFinal) {
          transcripts.push('');
        }
        const transcript = transcripts.join(' ').trim();
        socket.emit(OutgoingEvents.TRANSCRIPTION_DATA, transcript);
      })
      .on('finish', async () => {
        recognizeStream.removeAllListeners();
        const transcript = transcripts.join(' ').trim();
        if (transcript !== '') {
          try {
            socket.emit(OutgoingEvents.TRANSCRIPTION_END, transcript);

            // Translate recording
            const [translations] = await translateClient.translate(
              transcript,
              recordingData.targetLanguage,
            );
            const translationsArray = Array.isArray(translations) ? translations : [translations];
            const translation = translationsArray.join(' ');
            socket.emit(OutgoingEvents.TRANSLATION_DATA, translation);

            // Create audio
            const [response] = await textToSpeechClient.synthesizeSpeech({
              input: { text: translation },
              voice: { languageCode: recordingData.targetLanguage },
              audioConfig: { audioEncoding: 'MP3' },
            });
            socket.emit(OutgoingEvents.AUDIO_FILE, response.audioContent);
          } catch (error) {
            logger.error(error);
          }
        }
      });
  });

  socket.on(IncomingEvents.AUDIO_DATA, (data) => {
    if (recognizeStream) {
      recognizeStream.write(data);
    } else {
      console.error('Audio data received, but recognizeStream was not initialized');
    }
  });

  socket.on(IncomingEvents.STOP_RECORDING, () => {
    if (recognizeStream) {
      console.log('stopRecording');
      setTimeout(() => {
        recognizeStream.end();
      }, 500);
    } else {
      console.error('Stopping recording, but recognizeStream was not initialized');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
    socket.removeAllListeners();
  });
});

// useRouter(app);

// Endpoint not found error handler
app.use('*', (req, res): void => {
  logger.info(`no matching path for ${req.originalUrl}`);
  res.status(404).json({ message: `No matching path for ${req.originalUrl}` });
});

export default server;
