// AudioWorklet: converts microphone audio to 16 kHz, 16-bit little-endian mono PCM,
// the input format required by the Gemini Live API. Posts ~50 ms chunks (ArrayBuffer).
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples per output sample
    this.phase = 0;
    this.acc = 0;
    this.cnt = 0;
    this.chunk = new Int16Array(800);
    this.n = 0;
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
        this.chunk[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0;
        this.cnt = 0;
        if (this.n === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
