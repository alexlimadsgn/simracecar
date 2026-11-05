import { DurableObject } from 'cloudflare:workers';
import { CODE_CHARS, CODE_RE, COUNTDOWN, ClientMsg, FINISH_WINDOW, MAX_PLAYERS, MAX_TRACKS, POINTS, PROTOCOL, PlayerCar, PlayerInfo, RESULTS_PAUSE, ResultRow, ServerMsg } from '../src/net/protocol';

interface Env { ROOM: DurableObjectNamespace<Room> }

interface Player extends PlayerInfo { ws: WebSocket; seen: number; ready: boolean; progress: number; finishedAt: number | null; timeSum: number }

const BODIES = ['sedan', 'hatch', 'suv', 'pickup', 'sport'], STIFF = ['macia', 'normal', 'firme'], ACC = ['spoiler', 'rack', 'lights', 'bullbar', 'exhaust', 'neon'];
const num = (v: unknown, min: number, max: number, or: number) => typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, v)) : or;
const color = (v: unknown) => Math.floor(num(v, 0, 0xffffff, 0x808080));

function cleanCar(c: Partial<PlayerCar> | undefined): PlayerCar {
  return {
    body: BODIES.includes(c?.body as string) ? c!.body! : 'sedan', paint: color(c?.paint), trim: color(c?.trim), rim: color(c?.rim),
    wheel: num(c?.wheel, .85, 1.6, 1), lift: num(c?.lift, 0, .45, 0), stiffness: STIFF.includes(c?.stiffness as string) ? c!.stiffness! : 'normal',
    accessories: Array.isArray(c?.accessories) ? c!.accessories.filter(a => ACC.includes(a)) : [],
  };
}

/** Uma sala existe só na memória: quando o último jogador sai, tudo se apaga. */
export class Room extends DurableObject<Env> {
  private code = '';
  private tracks = 0;
  private phase: 'free' | 'lobby' | 'race' | 'results' | 'final' = 'free';
  private players = new Map<WebSocket, Player>();
  private host = 0; private nextId = 1; private index = 0; private seed = 0; private goAt = 0;
  private timer: number | null = null;
  private sweep: number | null = null;

  /** Reserva a sala se o código estiver livre; sem ninguém entrar logo, ela volta a ficar livre. */
  reserve(code: string, tracks: number) {
    if (this.phase !== 'free') return false;
    this.code = code; this.tracks = tracks; this.phase = 'lobby';
    this.wait(30, () => { if (!this.players.size) this.reset(); });
    return true;
  }

  fetch(req: Request) {
    const pair = new WebSocketPair(), ws = pair[1];
    ws.accept();
    ws.addEventListener('message', e => this.receive(ws, e.data));
    ws.addEventListener('close', () => this.leave(ws));
    ws.addEventListener('error', () => this.leave(ws));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private wait(seconds: number, then: () => void) {
    clearTimeout(this.timer);
    this.timer = setTimeout(then, seconds * 1000);
  }

  private reset() {
    clearTimeout(this.timer); clearInterval(this.sweep); this.sweep = null;
    this.code = ''; this.tracks = 0; this.phase = 'free'; this.players.clear();
    this.host = 0; this.nextId = 1; this.index = 0;
  }

  private send(ws: WebSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch { /* conexão já caiu */ } }
  private refuse(ws: WebSocket, message: string) { this.send(ws, { t: 'error', message }); ws.close(1000); }

  private broadcast(m: ServerMsg) { for (const ws of this.players.keys()) this.send(ws, m); }

  private lobby() {
    const players = [...this.players.values()].map(({ id, name, car, points }) => ({ id, name, car, points }));
    for (const [ws, p] of this.players) this.send(ws, { t: 'lobby', code: this.code, you: p.id, host: this.host, tracks: this.tracks, players });
  }

  private receive(ws: WebSocket, data: unknown) {
    if (typeof data !== 'string' || data.length > 2048) return;
    let m: ClientMsg;
    try { m = JSON.parse(data); } catch { return; }
    const me = this.players.get(ws);
    if (!me) { if (m.t === 'hello') this.join(ws, m); return; }
    me.seen = Date.now();
    switch (m.t) {
      case 'p': {
        if (this.phase !== 'race' || m.r !== this.index || !Array.isArray(m.p) || m.p.length !== 3 || !Array.isArray(m.q) || m.q.length !== 4) return;
        if (![...m.p, ...m.q, m.v, m.s].every(n => typeof n === 'number' && isFinite(n))) return;
        me.progress = m.s;
        const out = JSON.stringify({ t: 'p', r: m.r, p: m.p, q: m.q, v: m.v, s: m.s, b: !!m.b, id: me.id });
        for (const other of this.players.keys()) if (other !== ws) { try { other.send(out); } catch { /* conexão já caiu */ } }
        break;
      }
      case 'start': if (me.id === this.host && this.phase === 'lobby') this.startRace(0); break;
      case 'ready': me.ready = true; this.checkReady(); break;
      case 'finish': this.finish(me); break;
    }
  }

  private join(ws: WebSocket, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (m.v !== PROTOCOL) return this.refuse(ws, 'Versão diferente da sala: atualize a página.');
    if (this.phase === 'free') return this.refuse(ws, 'Sala não encontrada.');
    if (this.phase !== 'lobby') return this.refuse(ws, 'O campeonato desta sala já começou.');
    if (this.players.size >= MAX_PLAYERS) return this.refuse(ws, 'Sala cheia.');
    const id = this.nextId++, name = String(m.name ?? '').trim().slice(0, 14) || `Piloto ${id}`;
    if (!this.host) this.host = id;
    this.players.set(ws, { ws, id, name, car: cleanCar(m.car), points: 0, seen: Date.now(), ready: false, progress: 0, finishedAt: null, timeSum: 0 });
    clearTimeout(this.timer);
    // o navegador avisa a cada 15 s; quem some sem fechar a conexão é retirado
    this.sweep ??= setInterval(() => {
      for (const [w, p] of this.players) if (Date.now() - p.seen > 150_000) { w.close(1000); this.leave(w); }
    }, 30_000);
    this.lobby();
  }

  private leave(ws: WebSocket) {
    const me = this.players.get(ws);
    if (!me) return;
    this.players.delete(ws);
    if (!this.players.size) return this.reset();
    if (me.id === this.host) this.host = this.players.values().next().value!.id;
    this.lobby();
    if (this.phase === 'race') { this.checkReady(); this.checkFinished(); }
  }

  private startRace(index: number) {
    this.phase = 'race'; this.index = index; this.goAt = 0; this.seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
    // quem está na frente do campeonato larga mais atrás
    const order = [...this.players.values()].sort((a, b) => a.points - b.points);
    order.forEach((p, slot) => {
      p.ready = false; p.finishedAt = null; p.progress = 0;
      this.send(p.ws, { t: 'race', index, total: this.tracks, seed: this.seed, slot });
    });
    this.wait(20, () => this.go());
  }

  private checkReady() {
    if (!this.goAt && [...this.players.values()].every(p => p.ready)) this.go();
  }

  private go() {
    clearTimeout(this.timer);
    this.goAt = Date.now() + COUNTDOWN * 1000;
    this.broadcast({ t: 'go' });
  }

  private finish(me: Player) {
    if (this.phase !== 'race' || !this.goAt || me.finishedAt) return;
    const first = ![...this.players.values()].some(p => p.finishedAt);
    me.finishedAt = Date.now();
    if (first) {
      this.broadcast({ t: 'deadline', seconds: FINISH_WINDOW });
      this.wait(FINISH_WINDOW, () => this.endRace());
    }
    this.checkFinished();
  }

  private checkFinished() {
    if (this.phase === 'race' && [...this.players.values()].every(p => p.finishedAt)) this.endRace();
  }

  private endRace() {
    clearTimeout(this.timer);
    const order = [...this.players.values()].sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) || b.progress - a.progress);
    const times = new Map<number, number | null>();
    order.forEach((p, k) => {
      p.points += POINTS[k];
      const time = p.finishedAt ? (p.finishedAt - this.goAt) / 1000 : null;
      times.set(p.id, time);
      // quem não terminou soma o tempo limite no desempate
      p.timeSum += time ?? (Date.now() - this.goAt) / 1000;
    });
    const final = this.index + 1 >= this.tracks;
    this.phase = final ? 'final' : 'results';
    // cada corrida mostra a chegada; a última mostra a classificação do campeonato
    const list = final ? [...order].sort((a, b) => b.points - a.points || a.timeSum - b.timeSum) : order;
    const rows: ResultRow[] = list.map((p, k) => ({ id: p.id, name: p.name, position: k + 1, time: times.get(p.id) ?? null, points: POINTS[order.indexOf(p)], total: p.points }));
    this.broadcast({ t: 'results', index: this.index, total: this.tracks, final, rows, next: final ? 0 : RESULTS_PAUSE });
    this.lobby();
    if (!final) this.wait(RESULTS_PAUSE, () => this.startRace(this.index + 1));
  }
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as { tracks?: unknown };
      const tracks = Math.floor(num(body.tracks, 1, MAX_TRACKS, 1));
      for (let k = 0; k < 30; k++) {
        const code = newCode();
        if (await env.ROOM.getByName(code).reserve(code, tracks)) return Response.json({ code });
      }
      return Response.json({ error: 'Nenhum código livre agora.' }, { status: 503 });
    }
    const m = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (m && req.headers.get('Upgrade') === 'websocket') {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Código inválido', { status: 400 });
      return env.ROOM.getByName(code).fetch(req);
    }
    return new Response('Não encontrado', { status: 404 });
  },
};
