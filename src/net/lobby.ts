import type { Garage } from '../game/garage';
import { MAX_PLAYERS, MAX_TRACKS, ResultsMsg } from './protocol';
import { RoomLink } from './room';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const NAME_KEY = 'sim-race-car:name:v1';

export const raceClock = (t: number | null) => {
  if (t === null) return 'Não terminou';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

/** Criar ou entrar em sala na tela inicial, e a sala de espera até a primeira largada. */
export function bindLobby(garage: Garage, begin: (room: RoomLink) => void) {
  const nameIn = $<HTMLInputElement>('roomName'), codeIn = $<HTMLInputElement>('roomCode'), tracksIn = $<HTMLInputElement>('roomTracks');
  const error = $('roomError'), lobby = $('lobby');
  tracksIn.max = String(MAX_TRACKS);
  const rooms = $('rooms'), lan = $('lan');
  const toggle = (open: boolean) => {
    rooms.hidden = !open;
    lan.setAttribute('aria-expanded', String(open));
    (open ? nameIn : lan).focus();
  };
  lan.onclick = () => toggle(rooms.hidden === true);
  $('roomClose').onclick = () => toggle(false);
  try { nameIn.value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* armazenamento indisponível */ }
  codeIn.oninput = () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };

  const enter = async (connect: (name: string) => Promise<RoomLink>) => {
    const name = nameIn.value.trim();
    try { localStorage.setItem(NAME_KEY, name); } catch { /* armazenamento indisponível */ }
    error.textContent = '';
    $<HTMLButtonElement>('roomCreate').disabled = $<HTMLButtonElement>('roomJoin').disabled = true;
    try {
      const room = await connect(name);
      const draw = () => {
        $('lobbyCode').textContent = room.code;
        $('lobbyInfo').textContent = `${room.tracks} ${room.tracks === 1 ? 'pista' : 'pistas'} · ${room.players.length}/${MAX_PLAYERS} jogadores`;
        const list = $('lobbyPlayers');
        list.innerHTML = '';
        for (const p of room.players) {
          const li = document.createElement('li');
          li.textContent = p.name + (p.id === room.host ? ' (anfitrião)' : '') + (p.id === room.you ? ' (você)' : '');
          list.append(li);
        }
        const host = room.you === room.host;
        $('lobbyStart').hidden = !host;
        $('lobbyWait').hidden = host;
      };
      room.onLobby = draw;
      draw();
      lobby.hidden = false;
      $('lobbyStart').onclick = () => room.send({ t: 'start' });
      room.onClose = () => location.reload();
      room.onRace = () => { lobby.hidden = true; room.onLobby = () => {}; begin(room); };
    } catch (e) {
      error.textContent = (e as Error).message;
    }
    $<HTMLButtonElement>('roomCreate').disabled = $<HTMLButtonElement>('roomJoin').disabled = false;
  };

  $('roomCreate').onclick = () => enter(name => RoomLink.create(Math.max(1, Math.min(MAX_TRACKS, Math.floor(+tracksIn.value) || 1)), name, garage.config));
  $('roomJoin').onclick = () => {
    if (codeIn.value.length !== 4) { error.textContent = 'O código tem 4 letras e números.'; return; }
    enter(name => RoomLink.join(codeIn.value, name, garage.config));
  };
  $('lobbyLeave').onclick = () => location.reload();
}

/** Resultado de cada corrida e, na última, o ranking final da sala. */
export function showResults(m: ResultsMsg, you: number) {
  $('standings').hidden = false;
  $('standingsTitle').textContent = m.final ? 'Ranking da sala' : `Corrida ${m.index + 1} de ${m.total}`;
  const body = $('standingsRows');
  body.innerHTML = '';
  for (const r of m.rows) {
    const tr = document.createElement('tr');
    if (r.id === you) tr.className = 'me';
    for (const text of [`${r.position}º`, r.name, raceClock(r.time), `+${r.points}`, String(r.total)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }
  $('standingsTime').textContent = m.final ? 'Última corrida' : 'Tempo';
  $('standingsGarage').hidden = !m.final;
  const next = $('standingsNext');
  next.hidden = m.final;
  let left = m.next;
  const tick = () => {
    next.textContent = `Próxima pista em ${left} s`;
    if (left-- > 0 && !$('standings').hidden) setTimeout(tick, 1000);
  };
  if (!m.final) tick();
}
