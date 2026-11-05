/** Som sintetizado do motor e dos pneus; nada de arquivos de áudio. */
export class CarSound {
  private ctx = new AudioContext();
  private a = this.ctx.createOscillator();
  private b = this.ctx.createOscillator();
  private engine = this.ctx.createGain();
  private tyre = this.ctx.createGain();
  private master = this.ctx.createGain();
  muted = false;
  private level = 1;
  private siren = this.ctx.createOscillator();
  private sirenGain = this.ctx.createGain();

  constructor() {
    const { ctx, a, b, engine, tyre, master } = this;
    a.type = 'sawtooth'; b.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    a.connect(lp); b.connect(lp); lp.connect(engine); engine.connect(master);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2;
    src.connect(bp); bp.connect(tyre); tyre.connect(master);
    tyre.gain.value = 0; master.gain.value = .25;
    master.connect(ctx.destination);
    this.siren.type = 'square'; this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain); this.sirenGain.connect(master); this.siren.start();
    a.start(); b.start(); src.start();
    void ctx.resume();
  }

  update(rpm: number, throttle: number, slip: number) {
    const t = this.ctx.currentTime, f = rpm / 60 * 2;
    this.a.frequency.setTargetAtTime(f, t, .03);
    this.b.frequency.setTargetAtTime(f * .5, t, .03);
    this.engine.gain.setTargetAtTime(.1 + throttle * .2, t, .05);
    this.tyre.gain.setTargetAtTime(slip > .3 ? Math.min(.35, (slip - .3) * 1.1) : 0, t, .05);
  }

  /** Sirene em dois tons, mais forte quanto mais perto a viatura. */
  police(volume: number) {
    const t = this.ctx.currentTime;
    this.siren.frequency.setTargetAtTime(Math.floor(t * 1.6) % 2 ? 620 : 860, t, .04);
    this.sirenGain.gain.setTargetAtTime(volume * .1, t, .1);
  }

  pause(on: boolean) { void (on ? this.ctx.suspend() : this.ctx.resume()); }

  toggle() {
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : .25 * this.level;
  }

  /** Volume geral, de 0 a 1. */
  setVolume(v: number) {
    this.level = v;
    this.master.gain.value = this.muted ? 0 : .25 * v;
  }

  close() { void this.ctx.close(); }
}
