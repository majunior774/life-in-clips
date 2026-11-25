import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const workletSource = readFileSync(new URL('../public/pcm-capture-worklet.js', import.meta.url), 'utf8');

function createWorklet() {
  let Processor;
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage(message) {
          this.messages.push(message);
        },
      };
    }
  }

  runInNewContext(workletSource, {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    sampleRate: 16000,
    registerProcessor: (_name, processor) => {
      Processor = processor;
    },
  });

  const processor = new Processor();
  return {
    processor,
    setCoachSpeaking(speaking) {
      processor.port.onmessage({ data: { type: 'coach-speaking', speaking } });
    },
    processChunk(value) {
      processor.process([[new Float32Array(800).fill(value)]], [], {});
    },
  };
}

test('suppresses mic audio during coach playback and forwards it after playback', () => {
  const worklet = createWorklet();
  worklet.setCoachSpeaking(true);
  worklet.processChunk(0.01);
  assert.equal(worklet.processor.port.messages.length, 0);

  worklet.setCoachSpeaking(false);
  worklet.processChunk(0.01);
  assert.equal(worklet.processor.port.messages.length, 1);
  assert.equal(typeof worklet.processor.port.messages[0].byteLength, 'number');
});

test('opens the mic and sends buffered onset after sustained user speech', () => {
  const worklet = createWorklet();
  worklet.setCoachSpeaking(true);
  worklet.processChunk(0.1);
  worklet.processChunk(0);
  worklet.processChunk(0.1);
  assert.equal(worklet.processor.port.messages.length, 0);

  worklet.processChunk(0.1);
  const interruption = worklet.processor.port.messages[0];
  assert.equal(interruption.type, 'interrupt');
  assert.equal(interruption.chunks.length, 2);
  assert.ok(interruption.chunks.every((chunk) => typeof chunk.byteLength === 'number'));

  worklet.processChunk(0.1);
  assert.equal(typeof worklet.processor.port.messages[1].byteLength, 'number');
});
