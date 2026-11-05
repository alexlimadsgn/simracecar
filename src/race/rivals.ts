import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Car, Controls } from '../game/car';
import { CarView, buildCar, poseCar } from '../game/carModel';
import { BodyType, DEFAULT_CONFIG, carTune } from '../game/config';
import { ROAD, SAMPLE, Track, nearestSample, offroadGrip, rng } from './track';

const BODIES: BodyType[] = ['sedan', 'hatch', 'suv', 'pickup', 'sport'];
const PAINTS = [0x1f5fc0, 0xe0a020, 0x1f8a55, 0xe8e8ec, 0x6a2fb0, 0xd9541a, 0x202226];
const WHEELBASE = 2.64;

export interface Rival {
  view: CarView; car: Car; ctl: Controls;
  /** distância percorrida desde a largada, em metros */
  s: number; sample: number; lat: number; lane: number; want: number; skill: number; top: number;
  stuck: number; backing: number; tries: number; flipped: number;
  prevP: THREE.Vector3; curP: THREE.Vector3; prevQ: THREE.Quaternion; curQ: THREE.Quaternion;
}

export interface Traffic { s: number; lane: number; v: number }

const toTarget = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
const other: Traffic = { s: 0, lane: 0, v: 0 };

/** Adversários dirigem o mesmo carro do jogador: só decidem volante, acelerador e freio. */
export class Rivals {
  list: Rival[] = [];

  constructor(private t: Track, world: RAPIER.World, scene: THREE.Scene, material: THREE.Material, count: number, seed: number) {
    const R = rng(seed);
    for (let k = 0; k < count; k++) {
      const config = { ...DEFAULT_CONFIG, body: BODIES[Math.floor(R() * BODIES.length)], paint: PAINTS[k % PAINTS.length], trim: PAINTS[k % PAINTS.length], accessories: [] };
      const view = buildCar(material, config);
      scene.add(view.root);
      this.list.push({
        view, car: new Car(world, carTune(config)), ctl: { throttle: 0, brake: 0, steer: 0, handbrake: true },
        s: 0, sample: 0, lat: 0, lane: 0, want: 0, skill: .84 + k / Math.max(1, count - 1) * .16 + (R() - .5) * .03, top: 48 + R() * 8,
        stuck: 0, backing: 0, tries: 0, flipped: 0,
        prevP: new THREE.Vector3(), curP: new THREE.Vector3(), prevQ: new THREE.Quaternion(), curQ: new THREE.Quaternion(),
      });
    }
  }

  /** Coloca os rivais no grid, à frente do jogador. */
  grid() {
    const last = this.list.length;
    this.list.forEach((r, k) => {
      r.lane = r.want = k % 2 ? 3.2 : -3.2;
      r.tries = 0;
      this.place(r, Math.round((-8 - (last - 1 - k) * 8) / SAMPLE), r.lane);
    });
  }

  private place(r: Rival, progress: number, lane: number) {
    const { t } = this, i = (progress % t.n + t.n) % t.n, j = (i + 1) % t.n;
    r.car.place(t.x[i] + t.nx[i] * lane, t.y[i] + .9, t.z[i] + t.nz[i] * lane, t.x[j] - t.x[i], t.z[j] - t.z[i]);
    r.s = progress * SAMPLE; r.sample = i; r.lat = lane;
    r.stuck = r.backing = r.flipped = 0;
    this.read(r);
    r.prevP.copy(r.curP); r.prevQ.copy(r.curQ);
  }

  private read(r: Rival) {
    const p = r.car.body.translation(), o = r.car.body.rotation();
    r.curP.set(p.x, p.y, p.z); r.curQ.set(o.x, o.y, o.z, o.w);
  }

  /** Volta à pista quando capotou ou não consegue sair de onde está, sem nascer em cima de ninguém. */
  private rescue(r: Rival, player: Traffic) {
    const free = (s: number) => Math.abs(s - r.s) > 12;
    if (!free(player.s) || this.list.some(o => o !== r && !free(o.s))) return;
    r.tries = 0;
    r.lane = r.want = 0;
    this.place(r, Math.round(r.s / SAMPLE), 0);
  }

  /** Decide os comandos e avança a física de cada carro; roda a cada passo da simulação. */
  step(dt: number, racing: boolean, player: Traffic) {
    const { t } = this;
    for (const r of this.list) {
      const { car, ctl } = r, v = car.speed, abs = Math.abs(v);
      const at = nearestSample(t, r.curP.x, r.curP.z, r.sample, 12);
      let delta = at - r.sample;
      if (delta > t.n / 2) delta -= t.n; else if (delta < -t.n / 2) delta += t.n;
      r.sample = at; r.s += delta * SAMPLE;
      r.lat = (r.curP.x - t.x[at]) * t.nx[at] + (r.curP.z - t.z[at]) * t.nz[at];
      car.grip = offroadGrip(Math.abs(r.lat));

      if (!racing) { ctl.throttle = 0; ctl.brake = 0; ctl.steer = 0; ctl.handbrake = true; car.step(dt, ctl); continue; }

      // quem vem atrás desvia; sem espaço, reduz
      let target = Math.min(r.top, t.safe[(at + 2 + Math.floor(abs * .25 / SAMPLE)) % t.n] * r.skill);
      const look = (o: Traffic) => {
        const gap = o.s - r.s;
        if (gap <= .1 || gap > 16 + abs * .4 || Math.abs(o.lane - r.lat) > 2.3) return;
        r.want = o.lane > 0 ? -3.4 : 3.4;
        if (gap < 7) target = Math.min(target, Math.max(4, o.v));
      };
      look(player);
      for (const o of this.list) if (o !== r) { other.s = o.s; other.lane = o.lat; other.v = o.car.speed; look(other); }
      const lim = ROAD - 2, want = Math.max(-lim, Math.min(lim, r.want));
      r.lane += Math.max(-dt * 2.2, Math.min(dt * 2.2, want - r.lane));

      // perseguição pura: mira um ponto adiante na pista, mais longe quanto maior a velocidade
      const a = (at + Math.ceil((7 + abs * .55) / SAMPLE)) % t.n;
      fwd.set(0, 0, 1).applyQuaternion(r.curQ); side.set(1, 0, 0).applyQuaternion(r.curQ);
      toTarget.set(t.x[a] + t.nx[a] * r.lane - r.curP.x, 0, t.z[a] + t.nz[a] * r.lane - r.curP.z);
      const ahead = toTarget.dot(fwd), left = toTarget.dot(side), d2 = Math.max(1, ahead * ahead + left * left);
      const steer = ahead > 0 ? Math.atan(2 * WHEELBASE * left / d2) / car.steerLimit(abs) : Math.sign(left) || 1;
      ctl.steer = Math.max(-1, Math.min(1, steer));

      // acelerador e freio seguem a velocidade que a pista permite
      const err = target - v;
      ctl.throttle = err > 0 ? Math.min(1, err * .6 + .1) : 0;
      ctl.brake = err < -.4 ? Math.min(1, -err * .22) : 0;
      ctl.handbrake = false;

      // preso em algum lugar: dá ré e tenta de novo; se não adiantar, volta para a pista
      if (r.backing > 0) {
        r.backing -= dt;
        ctl.throttle = 0; ctl.brake = 1; ctl.steer = -ctl.steer;
      } else if (abs < 1.5) {
        r.stuck += dt;
        if (r.stuck > 2) { r.stuck = 0; r.backing = 1.3; if (++r.tries > 2) this.rescue(r, player); }
      } else if (abs > 6) { r.stuck = 0; r.tries = 0; }
      up.set(0, 1, 0).applyQuaternion(r.curQ);
      r.flipped = up.y < .15 ? r.flipped + dt : 0;
      if (r.flipped > 2.5 || r.curP.y < -80) this.rescue(r, player);

      car.step(dt, ctl);
    }
  }

  /** Guarda a pose de cada carro depois do passo da física. */
  snap() {
    for (const r of this.list) { r.prevP.copy(r.curP); r.prevQ.copy(r.curQ); this.read(r); }
  }

  /** Desenha os carros entre os dois últimos passos da física. */
  draw(alpha: number) {
    for (const r of this.list) {
      r.view.root.position.lerpVectors(r.prevP, r.curP, alpha);
      r.view.root.quaternion.slerpQuaternions(r.prevQ, r.curQ, alpha);
      poseCar(r.view, r.car);
    }
  }
}
