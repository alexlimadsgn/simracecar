import './style.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { registerSW } from 'virtual:pwa-register';
import { Car } from './game/car';
import { CarView, buildCar, poseCar, toGeometry } from './game/carModel';
import { bindTouch, pressed, readControls } from './game/input';
import { CarSound } from './game/sound';
import { DEFAULT_SETTINGS, fogRange, loadSettings, saveSettings } from './game/settings';
import { Garage } from './game/garage';
import { carTune } from './game/config';
import { SAMPLE, Track, buildTrack, generateTrack, nearestSample, offroadGrip } from './race/track';
import { Rivals } from './race/rivals';
import { Ghosts } from './race/ghosts';
import { RoomLink } from './net/room';
import { bindLobby, showResults } from './net/lobby';

registerSW({ immediate: true });

// as cores do mundo são escritas diretamente em sRGB, sem texturas nem PBR
THREE.ColorManagement.enabled = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view'), startEl = $('start'), playBtn = $<HTMLButtonElement>('play'), statusEl = $('status');
const hud = $('hud'), touchEl = $('touch');
const garage = new Garage($<HTMLCanvasElement>('preview'), $('panel'));
const SKY = 0xa6d8f0, STEP = 1 / 120, LAPS = 3, RIVALS = 5;

const clock = (t: number) => {
  if (!isFinite(t)) return '--:--.-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

/** Traçado inteiro no canto da tela; é desenhado uma vez e depois só copiado. */
function trackMap(t: Track, size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]); z0 = Math.min(z0, t.z[i]); z1 = Math.max(z1, t.z[i]); }
  const k = (size * .72) / Math.max(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const px = (x: number) => size / 2 + (x - cx) * k, pz = (z: number) => size / 2 + (z - cz) * k;
  g.lineJoin = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i < t.n; i += 2) i ? g.lineTo(px(t.x[i]), pz(t.z[i])) : g.moveTo(px(t.x[i]), pz(t.z[i])); g.closePath(); g.stroke(); };
  g.strokeStyle = '#0b1820'; g.lineWidth = size * .05; path();
  g.strokeStyle = '#e8ecef'; g.lineWidth = size * .025; path();
  g.fillStyle = '#ff2a68'; g.fillRect(px(t.x[0]) - size * .015, pz(t.z[0]) - size * .015, size * .03, size * .03);
  return { c, px, pz };
}

async function start(room: RoomLink | null = null) {
  playBtn.disabled = true;
  statusEl.textContent = 'Desenhando a pista…';
  await new Promise(r => setTimeout(r, 30));
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 1300, 4800);
  const camera = new THREE.PerspectiveCamera(62, 1, .4, 6000);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x8a8468, 1.75));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.25);
  const sunDir = new THREE.Vector3(.55, 1, .35).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 700 });
  sun.shadow.normalBias = .08; sun.shadow.bias = -.0006;
  scene.add(sun, sun.target);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const car = new Car(world, carTune(garage.config));
  const view: CarView = buildCar(material, garage.config);
  scene.add(view.root);

  const ghosts = new Ghosts(world, scene, material), rivalCount = room ? 0 : RIVALS;
  // cada pista é um circuito novo: a anterior é descartada por inteiro
  let track!: Track, mesh: THREE.Mesh | null = null, collider: RAPIER.Collider | null = null, rivals: Rivals | null = null, map!: ReturnType<typeof trackMap>;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const prevP = new THREE.Vector3(), curP = new THREE.Vector3(), prevQ = new THREE.Quaternion(), curQ = new THREE.Quaternion();
  const snap = () => { const t = car.body.translation(), r = car.body.rotation(); curP.set(t.x, t.y, t.z); curQ.set(r.x, r.y, r.z, r.w); };
  const camDir = new THREE.Vector3(), camPos = new THREE.Vector3(), look = new THREE.Vector3(), tv = new THREE.Vector3(), tv2 = new THREE.Vector3();

  // estado da corrida; progress é a distância percorrida desde a largada, em amostras
  let sample = 0, progress = 0, lap = 0, lapStart = 0, raceTime = 0, best = Infinity, countdown = 0, finished = false, wrong = 0;
  let deadline = 0, poseAt = 0;
  const me = { s: 0, lane: 0, v: 0 };
  const heading = (i: number): [number, number] => { const j = (i + 1) % track.n; return [track.x[j] - track.x[i], track.z[j] - track.z[i]]; };
  const placeAt = (s: number, lane: number) => {
    const i = ((s % track.n) + track.n) % track.n, [hx, hz] = heading(i);
    car.place(track.x[i] + track.nx[i] * lane, track.y[i] + .9, track.z[i] + track.nz[i] * lane, hx, hz);
    snap(); prevP.copy(curP); prevQ.copy(curQ);
    sample = i;
    camDir.set(hx, 0, hz).normalize();
    camPos.copy(curP).addScaledVector(camDir, -7).add(tv.set(0, 3, 0));
  };
  const toGrid = () => {
    // na sala, a posição de largada vem do servidor e a contagem só começa com todos prontos
    const slot = room?.race?.slot ?? 0, lane = room ? (slot % 2 ? 3.2 : -3.2) : (RIVALS % 2 ? 3.2 : -3.2);
    progress = room ? -3 - slot * 2 : -Math.round((RIVALS + 1) * 8 / SAMPLE) - 1; lap = 0; raceTime = 0; lapStart = 0; countdown = room ? Infinity : 3.5; finished = false; wrong = 0; deadline = 0;
    placeAt(progress, lane);
    me.s = progress * SAMPLE; me.lane = lane; me.v = 0;
    rivals!.grid();
    $('banner').hidden = true; $('finish').hidden = true;
  };
  const loadTrack = (seed: number) => {
    if (collider) world.removeCollider(collider, false);
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    if (rivals) for (const r of rivals.list) { scene.remove(r.view.root); world.removeRigidBody(r.car.body); }
    track = generateTrack(seed);
    const m = buildTrack(track);
    mesh = new THREE.Mesh(toGeometry(m), material);
    mesh.matrixAutoUpdate = false; mesh.receiveShadow = mesh.castShadow = true;
    scene.add(mesh);
    const solid = Float32Array.from(m.solid), idx = new Uint32Array(solid.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    collider = world.createCollider(RAPIER.ColliderDesc.trimesh(solid, idx)!.setFriction(.4), ground);
    rivals = new Rivals(track, world, scene, material, rivalCount, seed ^ 31);
    map = trackMap(track, 380);
    best = Infinity;
    $('place').textContent = `${track.shape} · ${track.theme} · ${(track.length / 1000).toFixed(1)} km`;
    toGrid();
    world.step();
  };
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  if (room) {
    ghosts.sync(room.players, room.you);
    room.onPlayers = () => ghosts.sync(room.players, room.you);
    room.onPose = m => { if (m.r === room.race?.index) ghosts.receive(m, performance.now()); };
    room.onDeadline = s => { if (!finished) deadline = s; };
    room.onGo = () => { countdown = 3.5; };
    const race = () => { ghosts.clear(); loadTrack(room.race!.seed); room.send({ t: 'ready' }); };
    room.onRace = () => { $('standings').hidden = true; race(); };
    room.onResults = m => { finished = true; deadline = 0; banner.hidden = true; setPaused(false); showResults(m, room.you); };
    room.onClose = () => {
      if (!$('standingsGarage').hidden) return;
      $('standings').hidden = false;
      $('standingsTitle').textContent = 'Conexão com a sala perdida';
      $('standingsRows').innerHTML = ''; $('standingsNext').hidden = true; $('standingsGarage').hidden = false;
    };
    $('standingsGarage').onclick = () => location.reload();
    $('restart').hidden = $('newTrack').hidden = true;
    const wentEarly = room.goPending;
    race();
    if (wentEarly || room.goPending) countdown = 3.5;
  } else loadTrack(newSeed());

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  garage.close();
  startEl.hidden = true; startEl.style.display = 'none';
  hud.hidden = false;
  if (matchMedia('(pointer: coarse)').matches) touchEl.hidden = false;
  bindTouch(touchEl);
  document.documentElement.requestFullscreen?.().catch(() => {});
  (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  setTimeout(() => { $('help').style.opacity = '0'; }, 9000);

  let sound: CarSound | null = null;
  try { sound = new CarSound(); } catch { /* sem áudio */ }

  let hood = false, acc = 0, last = performance.now(), upsideDown = 0, ui = 0, paused = false;
  const kmh = $('kmh'), gearEl = $('gear'), rpmEl = $('rpmfill'), banner = $('banner');
  const camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const mapEl = $<HTMLCanvasElement>('minimap'), mapCtx = mapEl.getContext('2d')!;
  mapEl.width = mapEl.height = 380;
  const respawn = () => { placeAt(sample, 0); upsideDown = 0; };

  // preferências valem na hora e ficam salvas
  const settings = loadSettings();
  const volumeIn = $<HTMLInputElement>('volume'), fogIn = $<HTMLInputElement>('fog');
  const applySettings = () => {
    volumeIn.value = String(settings.volume); fogIn.value = String(settings.fog);
    $('volumeOut').textContent = `${settings.volume}%`;
    $('fogOut').textContent = settings.fog ? `${settings.fog}%` : 'Sem';
    sound?.setVolume(settings.volume / 100);
    const fog = scene.fog as THREE.Fog;
    [fog.near, fog.far] = fogRange(settings.fog);
    saveSettings(settings);
  };
  volumeIn.oninput = () => { settings.volume = +volumeIn.value; applySettings(); };
  fogIn.oninput = () => { settings.fog = +fogIn.value; applySettings(); };
  $('resetSettings').onclick = () => { Object.assign(settings, DEFAULT_SETTINGS); applySettings(); };
  applySettings();
  const pauseBtn = $('pause'), menu = $('menu');
  const setPaused = (on: boolean) => {
    paused = on;
    menu.hidden = !on; pauseBtn.hidden = on;
    sound?.pause(on);
    if (on) $('resume').focus();
  };
  pauseBtn.hidden = false;
  pauseBtn.addEventListener('click', () => setPaused(true));
  $('resume').addEventListener('click', () => setPaused(false));
  $('restart').addEventListener('click', () => { toGrid(); setPaused(false); });
  $('newTrack').addEventListener('click', () => { loadTrack(newSeed()); setPaused(false); });
  $('againBtn').addEventListener('click', toGrid);
  $('nextBtn').addEventListener('click', () => loadTrack(newSeed()));
  // a configuração já está salva: recarregar volta à garagem sem perder nada
  $('toGarage').addEventListener('click', () => location.reload());
  $('finishGarage').addEventListener('click', () => location.reload());

  const standing = () => {
    const mine = progress * SAMPLE;
    let ahead = rivals!.list.filter(r => r.s > mine).length;
    for (const g of ghosts.list.values()) if (g.s > mine) ahead++;
    return 1 + ahead;
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    if (pressed('KeyP') || pressed('Escape')) setPaused(!paused);
    // numa sala a corrida não para: o carro só fica sem comandos enquanto o menu está aberto
    if (paused && !room) { renderer.render(scene, camera); return; }

    const ctl = readControls();
    if (paused) { ctl.throttle = 0; ctl.steer = 0; ctl.brake = .6; }
    if (pressed('KeyR')) respawn();
    if (pressed('KeyC')) hood = !hood;
    if (pressed('KeyN')) sound?.toggle();

    const going = countdown <= 0 && !finished;
    if (countdown > 0) {
      countdown -= dt;
      ctl.throttle = 0; ctl.brake = 0; ctl.handbrake = true;
      banner.hidden = countdown <= 0 || countdown > 3;
      banner.textContent = String(Math.ceil(countdown));
      if (countdown <= 0) { banner.textContent = 'VAI!'; banner.hidden = false; setTimeout(() => { if (banner.textContent === 'VAI!') banner.hidden = true; }, 900); }
    }
    if (finished) { ctl.throttle = 0; ctl.brake = .6; ctl.steer = 0; }

    ghosts.update(now, dt);
    if (deadline > 0) deadline = Math.max(0, deadline - dt);
    acc += dt;
    while (acc >= STEP) {
      prevP.copy(curP); prevQ.copy(curQ);
      car.step(STEP, ctl);
      rivals!.step(STEP, going || finished, me);
      world.step();
      snap();
      rivals!.snap();
      acc -= STEP;
    }

    // progresso: só o avanço contínuo conta, então cortar a pista ou voltar não dá volta
    const at = nearestSample(track, curP.x, curP.z, sample);
    let delta = at - sample;
    if (delta > track.n / 2) delta -= track.n; else if (delta < -track.n / 2) delta += track.n;
    sample = at; progress += delta;
    const lat = (curP.x - track.x[at]) * track.nx[at] + (curP.z - track.z[at]) * track.nz[at], offBy = Math.abs(lat);
    car.grip = offroadGrip(offBy);
    me.s = progress * SAMPLE; me.lane = lat; me.v = car.speed;
    if (going) {
      raceTime += dt;
      const nowLap = Math.floor(progress / track.n);
      if (nowLap > lap) {
        best = Math.min(best, raceTime - lapStart); lapStart = raceTime; lap = nowLap;
        if (lap >= LAPS) {
          finished = true;
          if (room) {
            room.send({ t: 'finish' });
            banner.textContent = 'Chegou!'; banner.hidden = false;
            setTimeout(() => { if (banner.textContent === 'Chegou!') banner.hidden = true; }, 1500);
          } else {
          const pos = standing();
          $('finishTitle').textContent = pos === 1 ? 'Vitória!' : `${pos}º lugar`;
          $('finishInfo').textContent = `Tempo ${clock(raceTime)} · melhor volta ${clock(best)}`;
          $('finish').hidden = false;
          }
        }
      }
      tv.set(0, 0, 1).applyQuaternion(curQ);
      const [hx, hz] = heading(at), l = Math.hypot(hx, hz);
      wrong = (tv.x * hx + tv.z * hz) / l < -.3 && Math.abs(car.speed) > 3 ? wrong + dt : 0;
    }

    if (room?.race && now - poseAt > 66) {
      poseAt = now;
      room.send({ t: 'p', r: room.race.index, p: [curP.x, curP.y, curP.z], q: [curQ.x, curQ.y, curQ.z, curQ.w], v: car.speed, s: me.s, b: car.brakeOn });
    }

    const alpha = acc / STEP;
    view.root.position.lerpVectors(prevP, curP, alpha);
    view.root.quaternion.slerpQuaternions(prevQ, curQ, alpha);
    poseCar(view, car);
    rivals!.draw(alpha);

    tv.set(0, 1, 0).applyQuaternion(curQ);
    upsideDown = tv.y < .15 && Math.abs(car.speed) < 2 ? upsideDown + dt : 0;
    if (upsideDown > 3 || curP.y < -80) respawn();

    // câmera de perseguição, que não atravessa paredes
    tv.set(0, 0, 1).applyQuaternion(view.root.quaternion);
    tv.y *= .6;
    camDir.lerp(tv, 1 - Math.exp(-dt * 3.2)).normalize();
    const pos = view.root.position, sp = Math.abs(car.speed);
    if (hood) {
      camPos.copy(pos).add(tv2.set(0, .92, .55).applyQuaternion(view.root.quaternion));
      look.copy(camPos).addScaledVector(tv.set(0, -.02, 1).applyQuaternion(view.root.quaternion), 20);
      camera.up.set(0, 1, 0).applyQuaternion(view.root.quaternion);
    } else {
      const dist = 6.4 + sp * .02;
      tv2.copy(pos).add(look.set(0, 1.3, 0));
      const dx = -camDir.x * dist, dy = 1.25 - camDir.y * dist, dz = -camDir.z * dist, L = Math.hypot(dx, dy, dz);
      camRay.origin = { x: tv2.x, y: tv2.y, z: tv2.z };
      camRay.dir = { x: dx / L, y: dy / L, z: dz / L };
      const hit = world.castRay(camRay, L, true, undefined, undefined, undefined, car.body);
      const k = hit ? Math.max(.25, hit.timeOfImpact - .4) / L : 1;
      const target = tv.set(tv2.x + dx * k, tv2.y + dy * k, tv2.z + dz * k);
      camPos.lerp(target, hit ? 1 : 1 - Math.exp(-dt * 16));
      look.copy(pos).add(tv2.set(0, .85, 0)).addScaledVector(camDir, 3.5);
      camera.up.set(0, 1, 0);
    }
    camera.position.copy(camPos);
    camera.lookAt(look);
    const fov = 60 + Math.min(20, sp * .22);
    if (Math.abs(camera.fov - fov) > .05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    view.root.visible = !hood;

    sun.target.position.copy(pos);
    sun.position.copy(pos).addScaledVector(sunDir, 300);
    sound?.update(car.rpm, ctl.throttle || (car.gear < 0 ? ctl.brake : 0), car.slip);

    if ((ui -= dt) <= 0) {
      ui = .1;
      kmh.textContent = String(Math.round(sp * 3.6));
      gearEl.textContent = car.gear < 0 ? 'R' : String(car.gear);
      rpmEl.style.width = `${Math.min(100, car.rpm / 68)}%`;
      rpmEl.classList.toggle('red', car.rpm > 6000);
      $('rPos').textContent = `${standing()}/${room ? room.players.length : RIVALS + 1}`;
      $('rLap').textContent = `Volta ${Math.min(LAPS, Math.max(1, lap + 1))}/${LAPS}`;
      $('rTime').textContent = clock(raceTime - lapStart);
      $('rBest').textContent = `Melhor ${clock(best)}`;
      $('wrong').hidden = wrong < 1.2;
      if (room) $('place').textContent = deadline > 0 ? `Chegada encerra em ${Math.ceil(deadline)} s` : `Corrida ${room.race!.index + 1}/${room.race!.total} · sala ${room.code}`;

      mapCtx.clearRect(0, 0, 380, 380);
      mapCtx.drawImage(map.c, 0, 0);
      for (const r of rivals!.list) {
        mapCtx.fillStyle = '#ffd030';
        mapCtx.beginPath(); mapCtx.arc(map.px(r.view.root.position.x), map.pz(r.view.root.position.z), 9, 0, 6.3); mapCtx.fill();
      }
      for (const g of ghosts.list.values()) {
        if (!g.view.root.visible) continue;
        mapCtx.fillStyle = '#ffd030';
        mapCtx.beginPath(); mapCtx.arc(map.px(g.view.root.position.x), map.pz(g.view.root.position.z), 9, 0, 6.3); mapCtx.fill();
      }
      mapCtx.fillStyle = '#ff2a68'; mapCtx.strokeStyle = '#fff'; mapCtx.lineWidth = 4;
      mapCtx.beginPath(); mapCtx.arc(map.px(pos.x), map.pz(pos.z), 12, 0, 6.3); mapCtx.fill(); mapCtx.stroke();
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) Object.assign(window, { __g: { car, camera, renderer, world, scene, get track() { return track; }, get rivals() { return rivals; }, ghosts, room, finishNow() { progress = LAPS * track.n; }, get progress() { return progress; }, get raceTime() { return raceTime; }, get lap() { return lap; }, get countdown() { return countdown; }, loadTrack, placeAt, generateTrack } });
}

bindLobby(garage, room => {
  start(room).catch(err => {
    console.error(err);
    statusEl.textContent = 'Não foi possível iniciar: seu navegador precisa de WebGL2 e WebAssembly.';
    room.close();
  });
});

playBtn.addEventListener('click', () => {
  start().catch(err => {
    console.error(err);
    playBtn.disabled = false;
    statusEl.textContent = 'Não foi possível iniciar: seu navegador precisa de WebGL2 e WebAssembly.';
  });
});
