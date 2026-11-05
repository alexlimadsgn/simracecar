// Preferências do jogo, salvas no navegador entre as partidas.

export interface Settings {
  /** volume geral, de 0 a 100 */
  volume: number;
  /** alcance do cenário, em chunks */
  view: number;
  /** neblina, de 0 a 100 */
  fog: number;
}

export const DEFAULT_SETTINGS: Settings = { volume: 100, view: 6, fog: 0 };

const KEY = 'sim-race-car:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* armazenamento indisponível */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* armazenamento indisponível */ }
}

/** Início e fim da neblina em metros: em 0 ela só atinge o que já está além do cenário. */
export function fogRange(fog: number): [number, number] {
  const far = 4800 - fog / 100 * 4500;
  return [far * .27, far];
}
