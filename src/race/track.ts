import { MeshBuilder, V3 } from '../world/mesh';

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const SAMPLE = 6, ROAD = 7, RAIL = ROAD + 17;
/** Aderência conforme a distância do centro da pista. */
export const offroadGrip = (offBy: number) => offBy < ROAD + 1.5 ? 1 : offBy < ROAD + 4 ? .8 : .55;
const MIN_RADIUS = 36, MIN_GAP = RAIL * 2 + 14;

export interface Track {
  seed: number; shape: string; theme: string;
  x: Float32Array; z: Float32Array; y: Float32Array;
  /** normal à esquerda do sentido da corrida */
  nx: Float32Array; nz: Float32Array;
  /** velocidade máxima de cada amostra, em m/s, com aderência 1 */
  safe: Float32Array;
  curve: Float32Array;
  n: number; length: number;
}

/** Formatos: cada um pesa harmônicos diferentes do raio em torno do centro. */
const SHAPES: { name: string; a: [number, number, number, number]; jitter: number; pts: [number, number] }[] = [
  { name: 'Oval veloz', a: [.42, .05, .03, 0], jitter: .05, pts: [9, 12] },
  { name: 'Feijão', a: [.3, .28, .06, 0], jitter: .07, pts: [11, 14] },
  { name: 'Triângulo', a: [.08, .42, .04, 0], jitter: .08, pts: [11, 14] },
  { name: 'Trevo', a: [.06, .06, .4, 0], jitter: .06, pts: [16, 20] },
  { name: 'Técnico', a: [.2, .16, .14, .13], jitter: .13, pts: [18, 24] },
  { name: 'Montanha-russa', a: [.3, .14, .1, .05], jitter: .1, pts: [14, 18] },
];
const THEMES = ['Campo', 'Deserto', 'Neve', 'Outono'];

function attempt(seed: number): Track | null {
  const R = rng(seed), shape = SHAPES[Math.floor(R() * SHAPES.length)], base = 380 + R() * 420;
  const stretch = .7 + R() * .6, spin = R() * 6.28, count = shape.pts[0] + Math.floor(R() * (shape.pts[1] - shape.pts[0] + 1));
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28];
  const ctl: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const t = (k + (R() - .5) * .35) / count * Math.PI * 2;
    let r = 1;
    shape.a.forEach((a, h) => { r += a * (R() * .5 + .75) * Math.cos((h + 2) * t + ph[h]); });
    r = Math.max(.3, r + (R() - .5) * shape.jitter * 2) * base;
    const px = Math.cos(t) * r * stretch, pz = Math.sin(t) * r / stretch;
    ctl.push([px * Math.cos(spin) - pz * Math.sin(spin), px * Math.sin(spin) + pz * Math.cos(spin)]);
  }

  // Catmull-Rom fechada, bem densa, reamostrada depois em passos iguais
  const dense: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const p0 = ctl[(k + count - 1) % count], p1 = ctl[k], p2 = ctl[(k + 1) % count], p3 = ctl[(k + 2) % count];
    for (let s = 0; s < 24; s++) {
      const t = s / 24, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const resample = (pts: [number, number][]) => {
    const out: [number, number][] = [];
    let carry = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      while (carry <= L && L > 0) { const t = carry / L; out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); carry += SAMPLE; }
      carry -= L;
    }
    return out;
  };
  let pts = resample(dense);
  const radiusAt = (p: [number, number][], i: number, w = 3) => {
    const n = p.length, a = p[(i + n - w) % n], b = p[i], c = p[(i + w) % n];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    return area < 1e-6 ? 1e6 : ab * bc * ca / (4 * area);
  };
  // alisa só onde a curva é fechada demais; os trechos retos e as curvas abertas ficam como estão
  for (let it = 0; it < 240; it++) {
    const n = pts.length, next = pts.map(p => [p[0], p[1]] as [number, number]);
    let tight = false;
    for (let i = 0; i < n; i++) {
      if (radiusAt(pts, i) >= MIN_RADIUS) continue;
      tight = true;
      for (let o = -5; o <= 5; o++) {
        const k = (i + o + n) % n, a = pts[(k + n - 1) % n], b = pts[(k + 1) % n], f = .5 * (1 - Math.abs(o) / 6);
        next[k] = [next[k][0] + ((a[0] + b[0]) / 2 - next[k][0]) * f, next[k][1] + ((a[1] + b[1]) / 2 - next[k][1]) * f];
      }
    }
    pts = next;
    if (!tight) break;
    if (it % 20 === 19) pts = resample(pts);
  }
  pts = resample(pts);
  const n = pts.length, length = n * SAMPLE;
  if (length < 2200 || length > 7500) return null;
  for (let i = 0; i < n; i++) if (radiusAt(pts, i) < MIN_RADIUS * .85) return null;
  // voltas da pista não podem se tocar: as áreas de escape e as defensas precisam de espaço
  for (let i = 0; i < n; i += 2) for (let j = i + 8; j < n; j += 2) {
    const arc = Math.min(j - i, n - (j - i)) * SAMPLE;
    if (arc < MIN_GAP * 2.6) continue;
    if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < MIN_GAP) return null;
  }

  // a largada fica no início da reta mais longa
  const curv = pts.map((_, i) => 1 / radiusAt(pts, i));
  let bestStart = 0, bestLen = 0, run = 0;
  for (let i = 0; i < n * 2; i++) {
    if (curv[i % n] < 1 / 220) { run++; if (run > bestLen) { bestLen = run; bestStart = (i - run + 1 + n * 2) % n; } } else run = 0;
  }
  const off = (bestStart + Math.floor(Math.min(bestLen, n) * .55)) % n;
  pts = [...pts.slice(off), ...pts.slice(0, off)];

  // relevo periódico: fecha a volta na mesma altura, com rampa limitada
  const hills = shape.name === 'Montanha-russa' ? 26 : 6 + R() * 12;
  const w = [1, 2 + Math.floor(R() * 2), 4 + Math.floor(R() * 3)], wp = [R() * 6.28, R() * 6.28, R() * 6.28];
  let ys = pts.map((_, i) => {
    const u = i / n * Math.PI * 2;
    return hills * (Math.sin(u * w[0] + wp[0]) * .6 + Math.sin(u * w[1] + wp[1]) * .3 + Math.sin(u * w[2] + wp[2]) * .15);
  });
  const maxStep = .07 * SAMPLE;
  for (let pass = 0; pass < 40; pass++) {
    const o = ys.slice();
    let over = false;
    for (let i = 0; i < n; i++) {
      const a = ys[(i + n - 1) % n], b = ys[(i + 1) % n];
      if (Math.abs(b - a) > maxStep * 1.6 || pass < 8) { o[i] = (a + ys[i] * 2 + b) / 4; over = true; }
    }
    ys = o;
    if (!over) break;
  }

  const X = new Float32Array(n), Z = new Float32Array(n), Y = Float32Array.from(ys), NX = new Float32Array(n), NZ = new Float32Array(n), K = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0; i < n; i++) { X[i] = pts[i][0]; Z[i] = pts[i][1]; }
  // sentido anti-horário sempre: a normal "esquerda" aponta para dentro do circuito
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += X[i] * Z[j] - X[j] * Z[i]; }
  if (area < 0) { X.reverse(); Z.reverse(); Y.reverse(); }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n, tx = X[b] - X[a], tz = Z[b] - Z[a], l = Math.hypot(tx, tz);
    NX[i] = tz / l; NZ[i] = -tx / l;
    K[i] = 1 / radiusAt([[X[(i + n - 3) % n], Z[(i + n - 3) % n]], [X[i], Z[i]], [X[(i + 3) % n], Z[(i + 3) % n]]], 1, 1);
    V[i] = Math.sqrt(9.3 / Math.max(K[i], 1e-4));
  }
  // antes da curva é preciso já ter freado
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
    const q = V[(i + 1) % n];
    V[i] = Math.min(V[i], Math.sqrt(q * q + 2 * 8.5 * SAMPLE));
  }
  return { seed, shape: shape.name, theme: THEMES[Math.floor(R() * THEMES.length)], x: X, z: Z, y: Y, nx: NX, nz: NZ, curve: K, safe: V, n, length };
}

/** Sempre devolve uma pista: tenta sementes derivadas até uma passar nas regras. */
export function generateTrack(seed: number): Track {
  for (let k = 0; k < 400; k++) {
    const t = attempt((seed + k * 7919) | 0);
    if (t) return t;
  }
  throw new Error('nenhuma pista válida');
}

const PALETTE: Record<string, { ground: number[]; run: number; tree: number; hill: number }> = {
  Campo: { ground: [0x6fa84e, 0x79b356, 0x66a04a], run: 0x88945a, tree: 0x3f8f3c, hill: 0x8a8d78 },
  Deserto: { ground: [0xd8b06a, 0xdcb873, 0xcfa660], run: 0xb99a66, tree: 0x7f9a50, hill: 0xb27f55 },
  Neve: { ground: [0xe6edf2, 0xdfe8ee, 0xeef3f6], run: 0xb9c3c9, tree: 0x2f6b55, hill: 0xf4f7f9 },
  Outono: { ground: [0xa49a4e, 0xb08f45, 0x98a050], run: 0x8d8a5a, tree: 0xc8622a, hill: 0x8d7a66 },
};

/** Monta a malha do circuito. Asfalto, escape, defensas e terreno também viram colisão. */
export function buildTrack(t: Track) {
  const m = new MeshBuilder(), { n, x, z, y, nx, nz, curve } = t, R = rng(t.seed ^ 77), pal = PALETTE[t.theme];
  const ASPHALT = 0x3a3d42, LINE = 0xf0f0e8, P = (i: number, o: number, h = 0): V3 => [x[i % n] + nx[i % n] * o, y[i % n] + h, z[i % n] + nz[i % n] * o];
  m.collide = true;
  for (let i = 0; i < n; i++) {
    const j = i + 1;
    m.quad(P(i, -ROAD), P(j, -ROAD), P(j, ROAD), P(i, ROAD), ASPHALT);
    for (const s of [-1, 1]) {
      // escape: desce suave da pista até a grama; a defensa fecha o lado de fora
      m.quad(P(i, s * ROAD), P(j, s * ROAD), P(j, s * (ROAD + 4), -.25), P(i, s * (ROAD + 4), -.25), pal.run);
      m.quad(P(i, s * (ROAD + 4), -.25), P(j, s * (ROAD + 4), -.25), P(j, s * RAIL, -.6), P(i, s * RAIL, -.6), pal.ground[i % 3]);
      m.quad(P(i, s * RAIL, -.6), P(j, s * RAIL, -.6), P(j, s * RAIL, 1.1), P(i, s * RAIL, 1.1), i % 10 < 5 ? 0xd8dce0 : 0xc8ccd0);
    }
  }
  m.collide = false;
  for (let i = 0; i < n; i++) {
    const j = i + 1, e = .03;
    m.quad(P(i, -ROAD + .35, e), P(j, -ROAD + .35, e), P(j, -ROAD + .6, e), P(i, -ROAD + .6, e), LINE);
    m.quad(P(i, ROAD - .6, e), P(j, ROAD - .6, e), P(j, ROAD - .35, e), P(i, ROAD - .35, e), LINE);
    if (i % 4 === 0) m.quad(P(i, -.12, e), P(j, -.12, e), P(j, .12, e), P(i, .12, e), LINE);
    // zebra só nas curvas, do lado de dentro e de fora
    if (curve[i] > 1 / 130) for (const s of [-1, 1]) {
      const c = i % 2 ? 0xd8262c : 0xf4f4f0;
      m.quad(P(i, s * ROAD, .06), P(j, s * ROAD, .06), P(j, s * (ROAD + 1.3), .02), P(i, s * (ROAD + 1.3), .02), c);
    }
  }
  // linha de chegada xadrez e pórtico
  for (let a = 0; a < 14; a++) for (let b = 0; b < 2; b++) {
    const o = -ROAD + a, e = .04, d = (u: number, q: number): V3 => {
      const px = P(0, q), f = (u - 1) * 1.5, tx = -nz[0], tz = nx[0];
      return [px[0] + tx * f, px[1] + e, px[2] + tz * f];
    };
    m.quad(d(b, o), d(b + 1, o), d(b + 1, o + 1), d(b, o + 1), (a + b) % 2 ? 0x111111 : 0xf8f8f8);
  }
  const yaw0 = Math.atan2(nz[0], -nx[0]) ;
  for (const s of [-1, 1]) { const p = P(0, s * (ROAD + 1)); m.box(p[0], p[1], p[2], .4, 7.5, .4, 0x2a2d33, yaw0); }
  const top = P(0, 0);
  m.box(top[0], top[1] + 6.3, top[2], ROAD + 1.4, 1.5, .3, 0x16181c, yaw0);
  for (let a = 0; a < 8; a++) { const o = (a - 3.5) * 2, p = P(0, o); m.box(p[0], p[1] + 6.8, p[2] - 0, .9, .5, .34, a % 2 ? 0xffffff : 0xe0202a, yaw0); }
  // arquibancadas ao lado da reta
  for (let i = -18; i <= 18; i += 6) {
    const k = (i + n) % n, p = P(k, ROAD + 30), yaw = Math.atan2(nz[k], -nx[k]);
    for (let f = 0; f < 4; f++) {
      const q = P(k, ROAD + 28 + f * 2.2);
      m.box(q[0], p[1], q[2], 17, 1 + f * 1.3, 1.1, f % 2 ? 0x8a8f96 : 0xa6abb2, yaw);
      for (let c = 0; c < 9; c++) {
        const a = (c - 4) * 3.6;
        m.box(q[0] - nz[k] * a, p[1] + 1 + f * 1.3, q[2] + nx[k] * a, .35, .8, .3, [0xe0483a, 0x3a7ae0, 0xf0c030, 0x40b060][Math.floor(R() * 4)], yaw);
      }
    }
  }

  // terreno: plano junto à pista, ondulado mais longe e subindo em morros nas bordas
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); z0 = Math.min(z0, z[i]); z1 = Math.max(z1, z[i]); }
  const pad = 620, G = 24; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  const nX = Math.ceil((x1 - x0) / G), nZ = Math.ceil((z1 - z0) / G), H = new Float32Array((nX + 1) * (nZ + 1));
  const a0 = R() * 10, a1 = R() * 10;
  const bump = (px: number, pz: number) => Math.sin(px / 190 + a0) * Math.cos(pz / 230 + a1) * 9 + Math.sin(px / 73 + a1) * Math.sin(pz / 91 + a0) * 2.5;
  // índice grosso das amostras acelera a busca da pista mais próxima
  const nearest = (px: number, pz: number) => {
    let best = 1e12, by = 0;
    for (let i = 0; i < n; i += 3) { const d = (x[i] - px) ** 2 + (z[i] - pz) ** 2; if (d < best) { best = d; by = y[i]; } }
    return [Math.sqrt(best), by];
  };
  const dist = new Float32Array(H.length);
  for (let j = 0; j <= nZ; j++) for (let i = 0; i <= nX; i++) {
    const px = x0 + i * G, pz = z0 + j * G, [d, by] = nearest(px, pz), k = j * (nX + 1) + i;
    const edge = Math.min(px - x0, x1 - px, pz - z0, z1 - pz);
    const f = smooth(RAIL + G * 1.5, RAIL + 170, d);
    dist[k] = d;
    H[k] = by - 1 + f * (bump(px, pz) + 2 - (by - 1) * .5) + smooth(420, 0, edge) ** 1.6 * 150 * (.7 + .3 * Math.sin(px / 130 + pz / 170 + a0));
  }
  m.collide = true;
  for (let j = 0; j < nZ; j++) for (let i = 0; i < nX; i++) {
    const a = j * (nX + 1) + i, ax = x0 + i * G, az = z0 + j * G;
    const A: V3 = [ax, H[a], az], B: V3 = [ax + G, H[a + 1], az], C: V3 = [ax, H[a + nX + 1], az + G], D: V3 = [ax + G, H[a + nX + 2], az + G];
    const peak = Math.max(A[1], B[1], C[1], D[1]);
    const col = peak > 55 ? pal.hill : pal.ground[(i * 7 + j * 13) % 3];
    m.quad(A, C, D, B, col);
  }
  m.collide = false;

  // árvores e pedras fora da área de corrida
  for (let k = 0; k < 900; k++) {
    const px = x0 + R() * (x1 - x0), pz = z0 + R() * (z1 - z0), gi = Math.floor((px - x0) / G), gj = Math.floor((pz - z0) / G), a = gj * (nX + 1) + gi;
    if (dist[a] < RAIL + 16 || H[a] > 70) continue;
    const s = .8 + R() * 1.1;
    if (t.theme === 'Deserto' && R() < .5) { m.prism(px, H[a] - .3, pz, 1.6 * s, .6 * s, 2 * s, 5, 0x9a8468); continue; }
    m.box(px, H[a] - .3, pz, .3 * s, 2.4 * s, .3 * s, 0x6a4a30);
    m.prism(px, H[a] + 1.8 * s, pz, 2.2 * s, .2, 3.6 * s, 6, pal.tree);
    m.prism(px, H[a] + 3.6 * s, pz, 1.6 * s, .1, 2.8 * s, 6, pal.tree);
  }
  return m;
}

/** Procura a amostra mais próxima em uma janela em torno da última conhecida. */
export function nearestSample(t: Track, px: number, pz: number, from: number, span = 40) {
  let best = 1e12, at = from;
  for (let o = -span; o <= span; o++) {
    const i = ((from + o) % t.n + t.n) % t.n, d = (t.x[i] - px) ** 2 + (t.z[i] - pz) ** 2;
    if (d < best) { best = d; at = i; }
  }
  return at;
}
