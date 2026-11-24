// Captures raw microphone PCM in memory and hands it to the page in small chunks. Nothing is stored.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.n) {
          const out = this.buf.slice(0, this.n);
          this.port.postMessage(out, [out.buffer]);
        }
        this.buf.fill(0);
        this.n = 0;
        this.port.postMessage('flushed');
      }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          const out = this.buf.slice();
          this.port.postMessage(out, [out.buffer]);
          this.buf.fill(0);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
