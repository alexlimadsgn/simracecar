// Mensagens trocadas entre o jogo e a sala. Mudou o formato? Aumente PROTOCOL.

export const PROTOCOL = 1, MAX_PLAYERS = 6, MAX_TRACKS = 10, COUNTDOWN = 3.5, FINISH_WINDOW = 60, RESULTS_PAUSE = 10;
export const POINTS = [10, 6, 4, 3, 2, 1];
// sem 0/O e 1/I, que se confundem ao ditar o código
export const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_RE = /^[2-9A-HJ-NP-Z]{4}$/;

export interface PlayerCar { body: string; paint: number; trim: number; rim: number; wheel: number; lift: number; stiffness: string; accessories: string[] }
export interface PlayerInfo { id: number; name: string; car: PlayerCar; points: number }
export interface ResultRow { id: number; name: string; position: number; time: number | null; points: number; total: number }

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; car: PlayerCar }
  | { t: 'start' } | { t: 'ready' } | { t: 'finish' } | { t: 'ping' }
  | PoseMsg;

export interface PoseMsg { t: 'p'; r: number; p: number[]; q: number[]; v: number; s: number; b: boolean; id?: number }
export interface LobbyMsg { t: 'lobby'; code: string; you: number; host: number; tracks: number; players: PlayerInfo[] }
export interface RaceMsg { t: 'race'; index: number; total: number; seed: number; slot: number }
export interface ResultsMsg { t: 'results'; index: number; total: number; final: boolean; rows: ResultRow[]; next: number }

export type ServerMsg =
  | LobbyMsg | RaceMsg | ResultsMsg | PoseMsg
  | { t: 'go' } | { t: 'deadline'; seconds: number } | { t: 'error'; message: string };
