import speech from '@google-cloud/speech';

const client = new speech.SpeechClient();

export const recognizeStream = client
  .streamingRecognize({
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 44100,
      languageCode: 'en-US',
    },
    interimResults: false, // If you want interim results, set this to true
  })
  .on('error', console.error)
  .on('data', (data) => {
    console.log(`Transcription: ${data.results[0].alternatives[0].transcript}`);
  });
