// AudioWorklet: converts microphone audio to 16 kHz, 16-bit little-endian mono PCM,
// the input format required by the Gemini Live API. Posts ~50 ms chunks (ArrayBuffer).
// Normalized PCM RMS; two consecutive 50 ms chunks are required to interrupt.
const INTERRUPT_RMS_THRESHOLD = 0.025;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples per output sample
    this.phase = 0;
    this.acc = 0;
    this.cnt = 0;
    this.chunk = new Int16Array(800);
    this.n = 0;
    this.sumSquares = 0;
    this.coachSpeaking = false;
    this.interruptChunks = 0;
    this.pendingChunk = null;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'coach-speaking' && event.data.speaking !== this.coachSpeaking) {
        this.coachSpeaking = event.data.speaking;
        this.interruptChunks = 0;
        this.pendingChunk = null;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // Box-filter average of the input samples that fall into each output sample.
      this.acc += ch[i];
      this.cnt += 1;
      this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        const s = Math.max(-1, Math.min(1, this.acc / this.cnt));
        const pcm = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.chunk[this.n++] = pcm;
        const normalized = pcm / 32768;
        this.sumSquares += normalized * normalized;
        this.acc = 0;
        this.cnt = 0;
        if (this.n === this.chunk.length) {
          this.postChunk();
          this.n = 0;
          this.sumSquares = 0;
        }
      }
    }
    return true;
  }

  postChunk() {
    const chunk = this.chunk.buffer.slice(0);
    if (!this.coachSpeaking) {
      this.port.postMessage(chunk);
      return;
    }

    const rms = Math.sqrt(this.sumSquares / this.chunk.length);
    if (rms < INTERRUPT_RMS_THRESHOLD) {
      this.interruptChunks = 0;
      this.pendingChunk = null;
      return;
    }

    this.interruptChunks += 1;
    if (this.interruptChunks === 1) {
      this.pendingChunk = chunk;
      return;
    }

    this.coachSpeaking = false;
    this.interruptChunks = 0;
    this.port.postMessage({ type: 'interrupt', chunks: [this.pendingChunk, chunk] });
    this.pendingChunk = null;
  }
}

registerProcessor('pcm-capture', PcmCapture);
