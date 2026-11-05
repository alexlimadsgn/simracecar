import type { CarConfig } from '../game/config';
import { ClientMsg, LobbyMsg, PROTOCOL, PlayerInfo, PoseMsg, RaceMsg, ResultsMsg, ServerMsg } from './protocol';

/** Conexão com a sala. Fechar a página fecha a conexão, e a sala tira o jogador. */
export class RoomLink {
  players: PlayerInfo[] = [];
  you = 0; host = 0; tracks = 0; code = '';
  race: RaceMsg | null = null;
  /** a largada pode chegar enquanto a pista ainda está sendo montada */
  goPending = false;
  onLobby = () => {};
  onPlayers = () => {};
  onRace = (_m: RaceMsg) => {};
  onGo = () => { this.goPending = true; };
  onPose = (_m: PoseMsg) => {};
  onDeadline = (_seconds: number) => {};
  onResults = (_m: ResultsMsg) => {};
  onError = (_message: string) => {};
  onClose = () => {};
  private ping = 0;

  private constructor(private ws: WebSocket) {}

  static async create(tracks: number, name: string, car: CarConfig) {
    const res = await fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ tracks }) });
    const data = await res.json() as { code?: string; error?: string };
    if (!data.code) throw new Error(data.error ?? 'Não foi possível criar a sala.');
    return RoomLink.join(data.code, name, car);
  }

  static join(code: string, name: string, car: CarConfig) {
    return new Promise<RoomLink>((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${encodeURIComponent(code)}/ws`);
      const link = new RoomLink(ws);
      let joined = false;
      ws.onopen = () => {
        link.send({ t: 'hello', v: PROTOCOL, name, car: car as unknown as Extract<ClientMsg, { t: 'hello' }>['car'] });
        link.ping = window.setInterval(() => link.send({ t: 'ping' }), 15000);
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.t === 'error') { joined ? link.onError(m.message) : reject(new Error(m.message)); return; }
        link.receive(m);
        if (m.t === 'lobby' && !joined) { joined = true; resolve(link); }
      };
      ws.onclose = () => {
        clearInterval(link.ping);
        if (joined) link.onClose(); else reject(new Error('Não foi possível conectar à sala.'));
      };
    });
  }

  private receive(m: ServerMsg) {
    switch (m.t) {
      case 'lobby': this.applyLobby(m); break;
      case 'race': this.race = m; this.goPending = false; this.onRace(m); break;
      case 'go': this.onGo(); break;
      case 'p': this.onPose(m); break;
      case 'deadline': this.onDeadline(m.seconds); break;
      case 'results': this.onResults(m); break;
    }
  }

  private applyLobby(m: LobbyMsg) {
    this.players = m.players; this.you = m.you; this.host = m.host; this.tracks = m.tracks; this.code = m.code;
    this.onLobby(); this.onPlayers();
  }

  send(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.ws.close(); }
}
