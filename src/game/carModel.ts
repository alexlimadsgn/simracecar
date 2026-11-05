import * as THREE from 'three';
import { MeshBuilder, V3 } from '../world/mesh';
import type { Car } from './car';
import { CarConfig, DEFAULT_CONFIG, carTune } from './config';

const GLASS = 0x18d8e8, SIDE_GLASS = 0x10a8b8, BLACK = 0x24282a, STEEL = 0x8a9096;

export function toGeometry(m: MeshBuilder) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(m.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(m.nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(m.col), 3, true));
  return g;
}

const inset = (a: V3, b: V3, c: V3, d: V3, f: number, off: V3): V3[] => {
  const mid = [0, 1, 2].map(i => (a[i] + b[i] + c[i] + d[i]) / 4);
  return [a, b, c, d].map(p => [0, 1, 2].map(i => mid[i] + (p[i] - mid[i]) * f + off[i]) as V3);
};

/** Proporções de cada carroceria: altura do teto e posição da cabine ao longo do carro. */
const SHAPES = {
  sedan: { Y1: .18, yh: .25, By: .22, Bz0: -1.45, Bz1: 1, Rz0: -.92, Rz1: .2, Ry: .78, tail: 0 },
  hatch: { Y1: .18, yh: .25, By: .3, Bz0: -2.02, Bz1: 1, Rz0: -1.72, Rz1: .2, Ry: .82, tail: 0 },
  suv: { Y1: .3, yh: .36, By: .36, Bz0: -2.04, Bz1: 1.05, Rz0: -1.9, Rz1: .42, Ry: 1.08, tail: 0 },
  pickup: { Y1: .22, yh: .3, By: .28, Bz0: -.55, Bz1: 1, Rz0: -.48, Rz1: .34, Ry: .98, tail: 1 },
  sport: { Y1: .06, yh: .1, By: .12, Bz0: -1.25, Bz1: .65, Rz0: -.78, Rz1: -.12, Ry: .56, tail: 0 },
};

export interface CarView { root: THREE.Group; wheels: THREE.Group[]; brake: THREE.MeshBasicMaterial; contact: THREE.Mesh }

/** Sedã low poly original e variações. Frente em +Z, origem no centro de massa aproximado. */
export function buildCar(material: THREE.Material, cfg: CarConfig = DEFAULT_CONFIG): CarView {
  const BODY = cfg.paint, PINK = cfg.trim, S = SHAPES[cfg.body];
  const m = new MeshBuilder(), W = .9, L = 2.1, Y0 = -.42, { Y1, yh, By, Bz0, Bz1, Rz0, Rz1, Ry } = S, Rw = .84;
  const tune = carTune(cfg), BODY_DROP = -.1;

  for (const s of [-1, 1]) {
    m.quad([s * W, Y0, -L], [s * W, Y1, -L], [s * W, Y1, L], [s * W, Y0, L], BODY);
    m.box(s * (W + .02), Y0 + .22, -.1, .015, .32, .02, BODY);
    m.box(s * (W + .03), .05, -.25, .02, .05, .11, BLACK);
    m.box(s * (W + .03), .05, .55, .02, .05, .11, BLACK);
    m.box(s * (W + .09), yh, Bz1 - .15, .09, .13, .06, BLACK);
  }
  m.quad([-W, Y0, L], [-W, Y1, L], [W, Y1, L], [W, Y0, L], PINK);
  m.quad([-W, Y0, -L], [-W, Y1, -L], [W, Y1, -L], [W, Y0, -L], PINK);
  m.quad([-W, Y0, -L], [-W, Y0, L], [W, Y0, L], [W, Y0, -L], BLACK);
  m.quad([-W, Y1, L], [-W, yh, Bz1], [W, yh, Bz1], [W, Y1, L], PINK);
  if (S.tail) {
    // caçamba da picape: piso rebaixado e bordas
    m.quad([-W, Y1 - .12, -L], [-W, Y1 - .12, Bz0], [W, Y1 - .12, Bz0], [W, Y1 - .12, -L], BLACK);
    for (const s of [-1, 1]) m.box(s * (W - .05), Y1 - .12, (Bz0 - L) / 2, .05, .32, (L + Bz0) / 2, BODY);
    m.box(0, Y1 - .12, -L + .05, W, .32, .05, BODY);
  } else {
    m.quad([-W, Y1, -L], [-W, By, Bz0], [W, By, Bz0], [W, Y1, -L], PINK);
  }
  m.quad([-W, Y1, Bz0], [-W, Y1, Bz1], [-W, yh, Bz1], [-W, By, Bz0], BODY);
  m.quad([W, Y1, Bz0], [W, Y1, Bz1], [W, yh, Bz1], [W, By, Bz0], BODY);

  const fl: V3 = [-Rw - .03, yh, Bz1], fr: V3 = [Rw + .03, yh, Bz1], bl: V3 = [-Rw - .03, By, Bz0], br: V3 = [Rw + .03, By, Bz0];
  const tfl: V3 = [-.72, Ry, Rz1], tfr: V3 = [.72, Ry, Rz1], tbl: V3 = [-.72, Ry, Rz0], tbr: V3 = [.72, Ry, Rz0];
  m.quad(tfl, tbl, tbr, tfr, PINK);
  m.quad(fl, tfl, tfr, fr, PINK);
  m.quad(bl, tbl, tbr, br, PINK);
  m.quad(fl, tfl, tbl, bl, BODY);
  m.quad(fr, tfr, tbr, br, BODY);
  const ws = inset(fl, tfl, tfr, fr, .86, [0, .012, .012]); m.quad(ws[0], ws[1], ws[2], ws[3], GLASS);
  const rw = inset(bl, tbl, tbr, br, .84, [0, .012, -.012]); m.quad(rw[0], rw[1], rw[2], rw[3], SIDE_GLASS);
  for (const s of [-1, 1]) {
    const lerpP = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const base0: V3 = [s * (Rw + .03), By, Bz0], base1: V3 = [s * (Rw + .03), yh, Bz1], top0: V3 = [s * .72, Ry, Rz0], top1: V3 = [s * .72, Ry, Rz1];
    for (const [t0, t1] of [[.08, .47], [.53, .92]]) {
      const q = inset(lerpP(base0, base1, t0), lerpP(top0, top1, t0), lerpP(top0, top1, t1), lerpP(base0, base1, t1), .86, [s * .012, 0, 0]);
      m.quad(q[0], q[1], q[2], q[3], SIDE_GLASS);
    }
  }
  m.box(0, -.1, L, W - .02, .28, .02, BLACK);
  for (const s of [-1, 1]) m.box(s * .6, -.06, L + .025, .24, .2, .02, 0xdfe6c0);
  m.box(0, -.06, L + .02, .32, .2, .02, 0xe8a828);
  for (let i = 0; i < 4; i++) m.box(0, -.03 + i * .045, L + .04, .31, .015, .012, 0xb87c14);
  m.box(0, -.36, L + .02, W - .08, .17, .03, 0x5a6064);
  m.box(0, -.36, -L - .02, W - .08, .17, .03, 0x5a6064);
  m.box(0, -.08, -L - .015, .3, .15, .01, 0xe8e8e0);

  // acessórios
  const A = cfg.accessories;
  if (A.includes('spoiler')) {
    for (const s of [-1, 1]) m.box(s * .6, Y1, -L + .22, .05, .3, .06, BLACK);
    m.box(0, Y1 + .3, -L + .2, .88, .05, .18, PINK);
  }
  if (A.includes('rack')) {
    for (const s of [-1, 1]) m.box(s * .62, Ry, (Rz0 + Rz1) / 2, .04, .1, (Rz1 - Rz0) / 2 - .04, BLACK);
    for (let k = 0; k < 3; k++) m.box(0, Ry + .1, Rz0 + .1 + (k / 2) * (Rz1 - Rz0 - .2), .62, .03, .03, STEEL);
  }
  if (A.includes('lights')) {
    m.box(0, Ry, Rz1 - .08, .55, .05, .03, BLACK);
    for (let k = -3; k <= 3; k += 2) m.box(k * .15, Ry + .03, Rz1 - .04, .1, .12, .03, 0xfff6c8);
  }
  if (A.includes('bullbar')) {
    for (const s of [-1, 1]) m.box(s * .65, -.42, L + .16, .04, .72, .04, STEEL);
    m.box(0, .26, L + .16, .69, .05, .04, STEEL);
    m.box(0, -.08, L + .16, .69, .04, .04, STEEL);
  }
  if (A.includes('exhaust')) for (const s of [-1, 1]) m.box(s * .55, -.4, -L - .1, .07, .12, .1, STEEL);

  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(toGeometry(m), material);
  bodyMesh.castShadow = true;
  bodyMesh.position.y = BODY_DROP;
  root.add(bodyMesh);

  const groundY = -.1 - tune.rest - tune.wheel * .33;
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 4.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .42, depthWrite: false }));
  contact.position.y = groundY + .15;
  root.add(contact);
  if (A.includes('neon')) {
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: cfg.trim, transparent: true, opacity: .55, depthWrite: false }));
    neon.position.y = groundY + .17;
    root.add(neon);
  }

  const brake = new THREE.MeshBasicMaterial({ color: 0x7a0a10 });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(.36, .16, .03), brake);
    t.position.set(s * .6, BODY_DROP, -L - .015);
    root.add(t);
  }

  // rodas: discos facetados que crescem com o ajuste
  const r = .33 * tune.wheel, w = .24 * (1 + (tune.wheel - 1) * .7);
  const tyreGeo = new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(r * .52, r * .6, w + .02, 6).rotateZ(Math.PI / 2);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x33383a, flatShading: true });
  const hubMat = new THREE.MeshLambertMaterial({ color: cfg.rim, flatShading: true });
  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(), spin = new THREE.Group();
    const t = new THREE.Mesh(tyreGeo, tyreMat), h = new THREE.Mesh(hubGeo, hubMat);
    t.castShadow = true;
    spin.add(t, h); g.add(spin);
    root.add(g); wheels.push(g);
  }
  return { root, wheels, brake, contact };
}

/** Rodas, sombra de contato e luz de freio acompanham o estado da física. */
export function poseCar(view: CarView, car: Car) {
  car.wheels.forEach((w, i) => {
    const g = view.wheels[i];
    g.position.set(w.x, w.y - car.rest + w.comp, w.z);
    g.rotation.y = w.steer;
    g.children[0].rotation.x = w.spin;
  });
  view.contact.visible = car.wheels.some(w => w.contact);
  view.brake.color.setHex(car.brakeOn ? 0xff2020 : 0x7a0a10);
}
