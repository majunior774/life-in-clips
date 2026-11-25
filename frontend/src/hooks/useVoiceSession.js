import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { api } from '../lib/api.js';

const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live returns 16-bit PCM at 24 kHz
const GREETING = 'Greet the user in one short sentence and ask what they want to work on.';

function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then connect again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or choose an input device, then try again.';
    case 'NotReadableError':
      return 'The microphone is in use by another app or cannot be read. Close other apps using it and try again.';
    default:
      return `Could not start the microphone: ${err?.message || 'unknown error'}.`;
  }
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

/**
 * Voice transport for the AI coach (Gemini Live API over a WebSocket, via @google/genai).
 *
 * - The browser only ever holds a single-use, short-lived token minted by our server.
 * - Microphone audio is converted to 16 kHz PCM by an AudioWorklet; the coach's 24 kHz PCM
 *   replies are scheduled for gapless playback and flushed when the user interrupts.
 * - This hook knows nothing about movies or the dashboard. When the model calls the
 *   tool call it hands the name and raw arguments to `onToolCall(name, args)`, which returns
 *   `{ ok, message, ... }`; that is sent back to the model as the tool result.
 *
 * The message handling follows Google's Live API docs but has not been exercised against a
 * live session yet (see AGENTS.md).
 */
export function useVoiceSession({ onToolCall }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [coachSpeaking, setCoachSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);

  const liveRef = useRef(null);
  const ctxRef = useRef(null);
  const micNodeRef = useRef(null);
  const streamRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextTimeRef = useRef(0);
  const mutedRef = useRef(false);
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const idCounter = useRef(0);
  const openRef = useRef({ user: null, coach: null });
  const handledCalls = useRef(new Set());
  const onToolCallRef = useRef(onToolCall);
  useEffect(() => {
    onToolCallRef.current = onToolCall;
  }, [onToolCall]);

  const stopPlayback = useCallback(() => {
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    sourcesRef.current.clear();
    nextTimeRef.current = 0;
    micNodeRef.current?.port.postMessage({ type: 'coach-speaking', speaking: false });
    setCoachSpeaking(false);
  }, []);

  const cleanup = useCallback(() => {
    closingRef.current = true;
    try {
      liveRef.current?.close();
    } catch {
      // already closed
    }
    liveRef.current = null;
    if (micNodeRef.current) {
      micNodeRef.current.port.onmessage = null;
      micNodeRef.current.disconnect();
      micNodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopPlayback();
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    mutedRef.current = false;
    busyRef.current = false;
    setUserSpeaking(false);
    setMuted(false);
  }, [stopPlayback]);

  const playChunk = useCallback((b64) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pcm = base64ToInt16(b64);
    if (pcm.length === 0) return;
    micNodeRef.current?.port.postMessage({ type: 'coach-speaking', speaking: true });
    const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, nextTimeRef.current);
    src.start(startAt);
    nextTimeRef.current = startAt + buffer.duration;
    sourcesRef.current.add(src);
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (sourcesRef.current.size === 0) {
        micNodeRef.current?.port.postMessage({ type: 'coach-speaking', speaking: false });
        setCoachSpeaking(false);
      }
    };
    setCoachSpeaking(true);
  }, []);

  /** Transcript fragments arrive incrementally; append to the open entry for that speaker. */
  const appendTranscript = useCallback((role, text) => {
    if (!text) return;
    const open = openRef.current;
    const other = role === 'user' ? 'coach' : 'user';
    open[other] = null;
    if (!open[role]) open[role] = `${role}-${idCounter.current++}`;
    const id = open[role];
    setTranscript((items) => {
      const i = items.findIndex((t) => t.id === id);
      if (i === -1) return [...items, { id, role, text }];
      const copy = items.slice();
      copy[i] = { ...copy[i], text: copy[i].text + text };
      return copy;
    });
  }, []);

  const handleToolCalls = useCallback(async (calls) => {
    const responses = [];
    for (const fc of calls) {
      if (handledCalls.current.has(fc.id)) continue;
      handledCalls.current.add(fc.id);
      let response;
      try {
        response = await onToolCallRef.current(fc.name, fc.args ?? {});
      } catch (err) {
        response = { ok: false, message: `The action failed: ${err.message}` };
      }
      responses.push({ id: fc.id, name: fc.name, response });
    }
    if (responses.length) liveRef.current?.sendToolResponse({ functionResponses: responses });
  }, []);

  const handleMessage = useCallback(
    (msg) => {
      const sc = msg.serverContent;
      if (sc) {
        if (sc.interrupted) {
          stopPlayback();
          openRef.current.coach = null;
        }
        if (sc.inputTranscription?.text) {
          setUserSpeaking(true);
          appendTranscript('user', sc.inputTranscription.text);
        }
        for (const part of sc.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            setUserSpeaking(false);
            playChunk(part.inlineData.data);
          }
        }
        if (sc.outputTranscription?.text) appendTranscript('coach', sc.outputTranscription.text);
        if (sc.turnComplete) {
          openRef.current = { user: null, coach: null };
          setUserSpeaking(false);
        }
      }
      if (msg.toolCall?.functionCalls?.length) handleToolCalls(msg.toolCall.functionCalls);
    },
    [appendTranscript, handleToolCalls, playChunk, stopPlayback],
  );

  const connect = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    closingRef.current = false;
    setStatus('connecting');
    setError(null);
    setTranscript([]);
    openRef.current = { user: null, coach: null };
    handledCalls.current = new Set();

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error('This browser does not support microphone capture or Web Audio.');
      }

      // Create the audio context immediately so it stays inside the click's user gesture.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.resume();

      // 1. Single-use token from our server (the permanent API key never leaves it).
      const session = await api.voiceSession();

      // 2. Microphone.
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        throw new Error(micErrorMessage(err), { cause: err });
      }
      streamRef.current = stream;

      // 3. Gemini Live WebSocket using the ephemeral token and the server-provided config.
      const ai = new GoogleGenAI({ apiKey: session.token, httpOptions: { apiVersion: session.apiVersion } });
      const live = await ai.live.connect({
        model: session.model,
        config: session.config,
        callbacks: {
          onmessage: (msg) => handleMessage(msg),
          onerror: (e) => {
            if (closingRef.current) return;
            setError(e?.message || 'The voice connection reported an error.');
          },
          onclose: (e) => {
            if (closingRef.current) return;
            const reason = e?.reason ? ` (${e.reason})` : '';
            setError(`The voice session ended${reason}. Press Reconnect to start again.`);
            setStatus('error');
            cleanup();
          },
        },
      });
      liveRef.current = live;

      // 4. Stream microphone audio as 16 kHz PCM.
      await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
      const mic = new AudioWorkletNode(ctx, 'pcm-capture');
      mic.port.onmessage = (e) => {
        const sendAudio = (chunk) => {
          if (mutedRef.current || !liveRef.current) return;
          liveRef.current.sendRealtimeInput({
            audio: { data: bytesToBase64(new Uint8Array(chunk)), mimeType: 'audio/pcm;rate=16000' },
          });
        };
        if (e.data?.type === 'interrupt') {
          openRef.current.coach = null;
          stopPlayback();
          setUserSpeaking(true);
          e.data.chunks.forEach(sendAudio);
          return;
        }
        sendAudio(e.data);
      };
      ctx.createMediaStreamSource(stream).connect(mic);
      micNodeRef.current = mic;

      setStatus('connected');
      live.sendRealtimeInput({ text: GREETING });
    } catch (err) {
      cleanup();
      setError(err.message || 'Could not start the voice session.');
      setStatus('error');
    }
  }, [cleanup, handleMessage, stopPlayback]);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('idle');
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    mutedRef.current = !mutedRef.current;
    track.enabled = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  /** Tells the model something happened in the app; it will react with one short sentence. */
  const notify = useCallback((text) => {
    liveRef.current?.sendRealtimeInput({ text: `[App note] ${text}` });
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return { status, error, transcript, coachSpeaking, userSpeaking, muted, connect, disconnect, toggleMute, notify };
}
