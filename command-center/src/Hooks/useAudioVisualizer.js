import { useState, useEffect, useRef } from 'react';

export default function useAudioVisualizer(isListening) {
  const [audioData, setAudioData] = useState(new Array(12).fill(4)); // Default flat heights
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);
  const requestRef = useRef(null);

  useEffect(() => {
    if (!isListening) {
      // Jab mic band ho, toh wave ko wapas flat kar do
      setAudioData(new Array(12).fill(4));
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      return;
    }

    const startMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        audioContextRef.current = new (
          window.AudioContext || window.webkitAudioContext
        )();
        analyzerRef.current = audioContextRef.current.createAnalyser();

        // 32 bins is enough for our 12 bars (smooths out the data)
        analyzerRef.current.fftSize = 64;

        sourceRef.current =
          audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyzerRef.current);

        const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);

        const updateWave = () => {
          if (!analyzerRef.current) return;

          analyzerRef.current.getByteFrequencyData(dataArray);

          // Map raw frequency data (0-255) to reasonable CSS pixel heights (4px to 30px)
          const newHeights = Array.from(dataArray)
            .slice(0, 12)
            .map((value) => {
              const height = Math.max(4, (value / 255) * 30);
              return height;
            });

          setAudioData(newHeights);
          requestRef.current = requestAnimationFrame(updateWave);
        };

        updateWave();
      } catch (err) {
        console.error('Mic access denied or failed for visualizer', err);
      }
    };

    startMic();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isListening]);

  return audioData;
}
