import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CarView, buildCar } from '../game/carModel';
import { CarConfig, carTune } from '../game/config';
import type { PlayerInfo, PoseMsg } from '../net/protocol';

// desenha um pouco no passado: assim sempre há duas poses recebidas para interpolar
const DELAY = 130, MAX_EXTRAPOLATE = 250;

interface Pose { at: number; p: THREE.Vector3; q: THREE.Quaternion }
export interface Ghost { id: number; view: CarView; body: RAPIER.RigidBody; a: Pose | null; b: Pose | null; s: number; v: number; spin: number }

const out = new THREE.Vector3(), outQ = new THREE.Quaternion();

/** Carros dos outros jogadores: cada navegador calcula só a física do próprio carro. */
export class Ghosts {
  list = new Map<number, Ghost>();

  constructor(private world: RAPIER.World, private scene: THREE.Scene, private material: THREE.Material) {}

  sync(players: PlayerInfo[], you: number) {
    for (const p of players) {
      if (p.id === you || this.list.has(p.id)) continue;
      const config = p.car as unknown as CarConfig, view = buildCar(this.material, config), tune = carTune(config);
      view.root.visible = false;
      view.wheels.forEach((g, i) => g.position.set(i % 2 ? -.82 : .82, -tune.rest, i < 2 ? 1.32 : -1.32));
      this.scene.add(view.root);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500 - p.id * 10, 0));
      // mesmo grupo do carro local: as rodas não tratam outro carro como chão
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(.88, .42, 2.08).setTranslation(0, .12, 0).setFriction(.25).setCollisionGroups(0x0002ffff), body);
      this.list.set(p.id, { id: p.id, view, body, a: null, b: null, s: -1e9, v: 0, spin: 0 });
    }
    for (const [id, g] of this.list) if (!players.some(p => p.id === id)) {
      this.scene.remove(g.view.root);
      this.world.removeRigidBody(g.body);
      this.list.delete(id);
    }
  }

  /** Nova corrida: a pose da pista anterior não vale mais. */
  clear() {
    for (const g of this.list.values()) { g.a = g.b = null; g.s = -1e9; g.v = 0; g.view.root.visible = false; }
  }

  receive(m: PoseMsg, now: number) {
    const g = this.list.get(m.id ?? 0);
    if (!g) return;
    const pose: Pose = g.a && g.b ? g.a : { at: 0, p: new THREE.Vector3(), q: new THREE.Quaternion() };
    pose.at = now; pose.p.set(m.p[0], m.p[1], m.p[2]); pose.q.set(m.q[0], m.q[1], m.q[2], m.q[3]);
    g.a = g.b; g.b = pose;
    g.s = m.s; g.v = m.v;
    g.view.brake.color.setHex(m.b ? 0xff2020 : 0x7a0a10);
  }

  update(now: number, dt: number) {
    for (const g of this.list.values()) {
      if (!g.b) continue;
      if (g.a) {
        const span = Math.max(1, g.b.at - g.a.at), u = Math.min(1 + MAX_EXTRAPOLATE / span, (now - DELAY - g.a.at) / span);
        out.lerpVectors(g.a.p, g.b.p, Math.max(0, u));
        outQ.slerpQuaternions(g.a.q, g.b.q, Math.max(0, Math.min(1, u)));
      } else { out.copy(g.b.p); outQ.copy(g.b.q); }
      g.view.root.visible = true;
      g.view.root.position.copy(out);
      g.view.root.quaternion.copy(outQ);
      g.spin += g.v * dt / .33;
      for (const w of g.view.wheels) w.children[0].rotation.x = g.spin;
      g.body.setNextKinematicTranslation(out);
      g.body.setNextKinematicRotation(outQ);
    }
  }
}
