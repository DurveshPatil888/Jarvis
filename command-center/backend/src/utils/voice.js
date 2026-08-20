import googleTTS from 'google-tts-api';
import soundPlay from 'sound-play';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

// serializes calls so overlapping speak() calls within THIS process
// don't play simultaneously/garble. Note: this does NOT coordinate
// across processes -- AIRouter (main process) and a worker (separate
// forked process) could rarely still overlap each other's audio,
// since each imports its own independent copy of this module.
let queue = Promise.resolve();

async function speakNow(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  try {
    const url = googleTTS.getAudioUrl(trimmed, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com',
    });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`TTS fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const tempPath = path.join(os.tmpdir(), `deamon-voice-${Date.now()}.mp3`);
    await writeFile(tempPath, buffer);

    await soundPlay.play(tempPath);
    await unlink(tempPath).catch(() => {});
  } catch (err) {
    console.error('[voice] speak failed:', err.message);
  }
}

export function speak(text) {
  queue = queue.then(() => speakNow(text)).catch(() => {});
  return queue;
}
