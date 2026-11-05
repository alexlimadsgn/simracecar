// Configuração do carro do jogador, salva no navegador entre as partidas.

export type BodyType = 'sedan' | 'hatch' | 'suv' | 'pickup' | 'sport';
export type Stiffness = 'macia' | 'normal' | 'firme';
export type Accessory = 'spoiler' | 'rack' | 'lights' | 'bullbar' | 'exhaust' | 'neon';

export interface CarConfig {
  body: BodyType;
  paint: number;
  trim: number;
  rim: number;
  /** tamanho das rodas: 1 é o original */
  wheel: number;
  /** elevação da suspensão, em metros */
  lift: number;
  stiffness: Stiffness;
  accessories: Accessory[];
}

export const DEFAULT_CONFIG: CarConfig = {
  body: 'sedan', paint: 0x9c1636, trim: 0xff2a68, rim: 0x8a9096, wheel: 1, lift: 0, stiffness: 'normal', accessories: [],
};

const KEY = 'sim-race-car:config:v1';

export function loadConfig(): CarConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* armazenamento indisponível */ }
  return { ...DEFAULT_CONFIG, accessories: [] };
}

export function saveConfig(c: CarConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* armazenamento indisponível */ }
}

export function clearConfig() {
  try { localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ }
}

/** O que cada ajuste muda na física. */
export function carTune(c: CarConfig) {
  const k = c.stiffness === 'macia' ? .72 : c.stiffness === 'firme' ? 1.35 : 1;
  return { wheel: c.wheel, lift: c.lift, rest: .35 + c.lift, stiffness: k };
}
