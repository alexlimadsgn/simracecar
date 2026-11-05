import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export interface CarTune { wheel: number; lift: number; rest: number; stiffness: number }

export interface Controls { throttle: number; brake: number; steer: number; handbrake: boolean }

const MASS = 1320, ANTIROLL = 11000;
const MAX_BRAKE_F = 2300, MAX_BRAKE_R = 1250, HAND_BRAKE = 3000;
// curva de pneu de rua: perde pouca aderência depois do pico
const KAPPA0 = .12, ALPHA0 = .14, C = 1.25, B = 3.08;
const WHEELBASE = 2.64;
const GEARS = [3.5, 2.3, 1.65, 1.25, 1.0, .82], REVERSE = 3.3, FINAL = 3.7, IDLE = 900, REDLINE = 6800;
const CDA = .72, ROLL = 11;

const torqueCurve = (rpm: number) => {
  if (rpm < 1000) return 170;
  if (rpm < 4200) return 170 + (rpm - 1000) / 3200 * 200;
  if (rpm < REDLINE) return 370 - (rpm - 4200) / (REDLINE - 4200) * 90;
  return 0;
};

// as rodas ignoram destroços e outros carros: só o que tem o grupo padrão conta como chão
const GROUND_RAY = 0xffff0001;

const tmp = {
  up: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(), p: new THREE.Vector3(), o: new THREE.Vector3(),
  r: new THREE.Vector3(), v: new THREE.Vector3(), f: new THREE.Vector3(), s: new THREE.Vector3(), n: new THREE.Vector3(),
  w: new THREE.Vector3(), a: new THREE.Vector3(), lin: new THREE.Vector3(), ang: new THREE.Vector3(), com: new THREE.Vector3(),
  q: new THREE.Quaternion(), F: new THREE.Vector3(),
};

interface Wheel {
  x: number; y: number; z: number; front: boolean;
  omega: number; comp: number; prevComp: number; steer: number; spin: number; contact: boolean; slip: number; fz: number;
}

export class Car {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  wheels: Wheel[];
  gear = 1; // -1 ré, 1..6 marchas
  rpm = IDLE;
  speed = 0;
  steer = 0;
  grip = 1;
  brakeOn = false;
  power = 1;
  slip = 0;
  private shift = 0;
  private tc = 1;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  rollLift: number;
  rest: number; r: number; k: number; damp: number; wheelI: number;

  constructor(private world: RAPIER.World, tune: CarTune = { wheel: 1, lift: 0, rest: .35, stiffness: 1 }) {
    this.rest = tune.rest; this.r = .33 * tune.wheel;
    // quanto mais alto o carro, mais perto do centro de massa a força lateral atua
    this.rollLift = tune.lift * .85 + (this.r - .33) * .9;
    this.k = 30000 * tune.stiffness; this.damp = 2400 * Math.sqrt(tune.stiffness);
    this.wheelI = 1.1 * tune.wheel * tune.wheel;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false)
      .setLinearDamping(0).setAngularDamping(.05));
    // massa declarada à parte: CG baixo e inércia de um sedã real
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(.88, .42, 2.08).setTranslation(0, .12, 0).setDensity(0).setFriction(.25).setRestitution(.1).setCollisionGroups(0x0002ffff), this.body);
    this.body.setAdditionalMassProperties(MASS, { x: 0, y: -.12 + tune.lift * .2, z: .08 }, { x: 2300, y: 2500, z: 620 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.wheels = [[.82, 1.32, true], [-.82, 1.32, true], [.82, -1.32, false], [-.82, -1.32, false]].map(([x, z, front]) => ({
      x: x as number, y: -.1, z: z as number, front: front as boolean, omega: 0, comp: 0, prevComp: 0, steer: 0, spin: 0, contact: false, slip: 0, fz: 0,
    }));
  }

  place(x: number, y: number, z: number, hx: number, hz: number) {
    const yaw = Math.atan2(hx, hz);
    this.body.setTranslation({ x, y: y + this.rest + this.r - .68, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) { w.omega = 0; w.comp = w.prevComp = 0; }
    this.gear = 1; this.steer = 0;
  }

  /** Limita o ângulo ao que o pneu dianteiro aproveita: além disso ele só arrastaria. */
  steerLimit(abs: number) {
    return Math.min(.58, WHEELBASE * 12 / Math.max(1, abs * abs) + ALPHA0 * .95);
  }

  private tyre(kappa: number, tanA: number, mu: number, fz: number) {
    const sx = kappa / KAPPA0, sy = tanA / ALPHA0, s = Math.hypot(sx, sy);
    if (s < 1e-5) { tyreX = 0; tyreY = 0; return; }
    const F = mu * fz * Math.sin(C * Math.atan(B * s));
    tyreX = F * sx / s; tyreY = -F * sy / s;
  }

  step(dt: number, c: Controls) {
    const { up, fwd, side, p, o, r, v, f, s, n, a, lin, ang, com, q, F } = tmp;
    const b = this.body, rot = b.rotation(), tr = b.translation(), lv = b.linvel(), av = b.angvel(), wc = b.worldCom();
    q.set(rot.x, rot.y, rot.z, rot.w);
    p.set(tr.x, tr.y, tr.z); lin.set(lv.x, lv.y, lv.z); ang.set(av.x, av.y, av.z); com.set(wc.x, wc.y, wc.z);
    up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); side.set(1, 0, 0).applyQuaternion(q);
    const speed = lin.dot(fwd);
    this.speed = speed;

    // direção: menos ângulo em alta velocidade e cremalheira com velocidade limitada
    const abs = Math.abs(speed);
    const target = c.steer * this.steerLimit(abs), rate = 2.4 * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    // câmbio automático
    let throttle = c.throttle, brake = c.brake;
    if (this.gear > 0 && c.brake > .1 && !c.throttle && speed < .8) { this.gear = -1; }
    else if (this.gear < 0 && c.throttle > .1 && speed > -.8) { this.gear = 1; }
    if (this.gear < 0) { throttle = c.brake; brake = c.throttle; }
    this.shift = Math.max(0, this.shift - dt);
    const ratio = () => (this.gear < 0 ? -REVERSE : GEARS[this.gear - 1]) * FINAL;
    const rear = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    this.rpm = Math.max(IDLE, Math.abs(rear * ratio()) * 60 / (2 * Math.PI));
    if (this.gear > 0 && !this.shift) {
      // decide pela velocidade do carro: um pico de patinagem não pode trocar de marcha
      const roadRpm = (gear: number) => abs / this.r * GEARS[gear - 1] * FINAL * 60 / (2 * Math.PI);
      if (roadRpm(this.gear) > 6300 && this.gear < 6) { this.gear++; this.shift = .22; }
      else if (this.gear > 1 && roadRpm(this.gear - 1) < 5200 && roadRpm(this.gear) < (throttle > .6 ? 2600 : 1700)) { this.gear--; this.shift = .22; }
    }
    // controle de tração suavizado: corta torque quando as rodas traseiras patinam
    const rs = (this.wheels[2].slip + this.wheels[3].slip) / 2;
    const vLatCar = lin.dot(side), beta = abs > 4 ? Math.abs(vLatCar) / abs : 0;
    const allowed = rs > .09 ? Math.max(.15, 1 - (rs - .09) * 8) : 1;
    this.tc += (Math.min(allowed, beta > .07 ? Math.max(.2, 1 - (beta - .07) * 7) : 1) - this.tc) * Math.min(1, dt * 18);
    const engine = this.shift > 0 ? 0 : throttle > 0 ? torqueCurve(this.rpm) * throttle * this.tc * this.power : -(25 + this.rpm * .02);
    const driveEach = (throttle > 0 || this.rpm > IDLE + 150 ? engine : 0) * ratio() * .9 / 2;

    this.ray.dir.x = -up.x; this.ray.dir.y = -up.y; this.ray.dir.z = -up.z;
    const len = this.rest + this.r;
    let slipSum = 0;
    // suspensão primeiro, para aplicar a barra estabilizadora por eixo
    const hits: (RAPIER.RayColliderIntersection | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      o.set(w.x, w.y, w.z).applyQuaternion(q).add(p);
      this.ray.origin.x = o.x; this.ray.origin.y = o.y; this.ray.origin.z = o.z;
      const h = this.world.castRayAndGetNormal(this.ray, len, true, undefined, GROUND_RAY, undefined, b);
      hits.push(h);
      w.prevComp = w.comp;
      w.comp = h ? Math.max(0, len - h.timeOfImpact) : 0;
      w.contact = !!h;
    }
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], other = this.wheels[i ^ 1], h = hits[i];
      w.steer = w.front ? this.steer * (1 + Math.sign(this.steer) * Math.sign(w.x) * .08) : 0;
      const drive = w.front ? 0 : driveEach;
      let brakeT = brake * (w.front ? MAX_BRAKE_F : MAX_BRAKE_R);
      if (c.handbrake && !w.front) brakeT = HAND_BRAKE;

      let fx = 0, fy = 0, fzN = 0;
      if (h) {
        o.set(w.x, w.y, w.z).applyQuaternion(q).add(p);
        const point = a.copy(this.ray.dir).multiplyScalar(h.timeOfImpact).add(o);
        n.set(h.normal.x, h.normal.y, h.normal.z);
        if (n.lengthSq() < .25) n.copy(up);
        const compVel = (w.comp - w.prevComp) / dt;
        fzN = Math.max(0, this.k * w.comp + this.damp * compVel + ANTIROLL * (w.comp - other.comp));
        fzN = Math.min(fzN, 26000);
        w.fz = fzN;

        r.copy(point).sub(com);
        v.copy(ang).cross(r).add(lin);
        const co = Math.cos(w.steer), si = Math.sin(w.steer);
        f.copy(fwd).multiplyScalar(co).addScaledVector(side, si);
        f.addScaledVector(n, -f.dot(n)).normalize();
        s.copy(n).cross(f);
        const vx = v.dot(f), vy = v.dot(s);
        const mu = this.grip * (w.front ? 1.14 : 1.24);
        const vLong = Math.max(Math.abs(vx), 3), vLat = Math.max(Math.abs(vx), 2.5), tanA = vy / vLat;

        // integra a roda em sub-passos implícitos: a rigidez do pneu é alta demais para Euler simples
        const SUB = 4, hs = dt / SUB;
        let sumX = 0, sumY = 0;
        const kp0 = (w.omega * this.r - vx) / vLong;
        if (brakeT > 0 && !c.handbrake && kp0 < -.16) brakeT *= .35; // ABS
        for (let k = 0; k < SUB; k++) {
          const kappa = (w.omega * this.r - vx) / vLong;
          this.tyre(kappa, tanA, mu, fzN);
          const Fx = tyreX, Fy = tyreY;
          const d = .002;
          this.tyre(kappa + d, tanA, mu, fzN);
          const stiff = Math.max(0, (tyreX - Fx) / d) * this.r * this.r / vLong;
          w.omega += hs * (drive - Fx * this.r) / (this.wheelI + hs * stiff);
          const dB = brakeT * hs / this.wheelI;
          w.omega = Math.abs(w.omega) <= dB ? 0 : w.omega - Math.sign(w.omega) * dB;
          sumX += Fx; sumY += Fy;
        }
        fx = sumX / SUB; fy = sumY / SUB;
        w.slip = Math.max(Math.abs(kp0), 0);
        slipSum += Math.min(1, Math.abs(kp0) * 2 + Math.abs(tanA) * 1.2) * (fzN > 200 ? 1 : 0);

        // segura o carro parado (atrito estático), inclusive em ladeiras
        if (Math.hypot(vx, vy) < 1 && (!throttle || c.handbrake) && !(w.front && brake === 0 && abs > .5)) {
          const lim = mu * fzN;
          fx += Math.max(-lim, Math.min(lim, -vx * 2600)); fy += Math.max(-lim, Math.min(lim, -vy * 2600));
          w.omega = vx / this.r;
        }
        F.copy(up).multiplyScalar(fzN).multiplyScalar(dt);
        b.applyImpulseAtPoint(F, o, false);
        F.set(0, 0, 0).addScaledVector(f, fx * dt).addScaledVector(s, fy * dt);
        // aplicado um pouco acima do solo: atenua a rolagem como a geometria de suspensão faria
        point.addScaledVector(up, .22 + this.rollLift);
        b.applyImpulseAtPoint(F, point, false);
      } else {
        w.fz = 0; w.slip = 0;
        w.omega += dt * drive / this.wheelI;
        const dB = (brakeT + 6) * dt / this.wheelI;
        w.omega = Math.abs(w.omega) <= dB ? 0 : w.omega - Math.sign(w.omega) * dB;
      }
      w.omega = Math.max(-170, Math.min(170, w.omega));
      w.spin = (w.spin + w.omega * dt) % (Math.PI * 2);
    }
    this.slip = slipSum / 4;

    // controle de estabilidade: freia a guinada que excede o que a direção pediu
    if (abs > 5 && this.wheels.some(w => w.contact)) {
      const wanted = speed * Math.tan(this.steer) / WHEELBASE;
      const lim = 11 / Math.max(abs, 1);
      const err = ang.dot(up) - Math.max(-lim, Math.min(lim, wanted));
      if (Math.abs(err) > .08) {
        const t = Math.max(-7000, Math.min(7000, -(err - Math.sign(err) * .08) * 9000)) * dt;
        b.applyTorqueImpulse({ x: up.x * t, y: up.y * t, z: up.z * t }, false);
      }
    }
    this.brakeOn = brake > .05;

    // arrasto aerodinâmico e resistência ao rolamento
    const sp = lin.length();
    if (sp > .01) {
      const contact = this.wheels.some(w => w.contact);
      const drag = (CDA * sp + (contact ? ROLL : 0)) * sp * dt / sp;
      b.applyImpulse({ x: -lin.x * drag, y: -lin.y * drag, z: -lin.z * drag }, false);
    }
  }
}

let tyreX = 0, tyreY = 0;
