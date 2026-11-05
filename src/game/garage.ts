import * as THREE from 'three';
import { Accessory, BodyType, CarConfig, DEFAULT_CONFIG, Stiffness, carTune, clearConfig, loadConfig, saveConfig } from './config';
import { buildCar } from './carModel';

const BODIES: [BodyType, string][] = [['sedan', 'Sedã'], ['hatch', 'Hatch'], ['suv', 'SUV'], ['pickup', 'Picape'], ['sport', 'Esportivo']];
const PAINTS = [0x9c1636, 0x1f5fbf, 0x1d8a5c, 0xe0a81c, 0xe8eaec, 0x23262b, 0xd8571e, 0x6a2fb0];
const TRIMS = [0xff2a68, 0x2fe0e8, 0xffd030, 0x7cff5a, 0xf4f4f4, 0x303438, 0xff8a20, 0xb070ff];
const RIMS = [0x8a9096, 0xe8eaec, 0x1c1e20, 0xe0b030, 0xd83040];
const ACCESSORIES: [Accessory, string][] = [['spoiler', 'Aerofólio'], ['rack', 'Bagageiro'], ['lights', 'Faróis no teto'], ['bullbar', 'Quebra-mato'], ['exhaust', 'Escape duplo'], ['neon', 'Neon']];
const STIFF: [Stiffness, string][] = [['macia', 'Macia'], ['normal', 'Normal'], ['firme', 'Firme']];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Tela inicial: pré-visualização 3D girando e opções salvas a cada mudança. */
export class Garage {
  config = loadConfig();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, .1, 60);
  private holder = new THREE.Group();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private raf = 0;
  private confirmTimer = 0;

  constructor(private canvas: HTMLCanvasElement, private panel: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.add(new THREE.HemisphereLight(0xdff2ff, 0x667080, 1.9), this.holder);
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.3); sun.position.set(3, 6, 4);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.6, 8).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c5a72, flatShading: true }));
    floor.position.y = -.99;
    this.scene.add(floor);
    this.camera.position.set(0, 1.6, 10.5);
    this.camera.lookAt(0, -.05, 0);
    this.renderUI();
    this.rebuild();
    addEventListener('resize', this.resize);
    this.resize();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.holder.rotation.y = t * .0005;
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize = () => {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private rebuild() {
    this.holder.clear();
    const view = buildCar(this.material, this.config), tune = carTune(this.config), comp = .1;
    view.contact.visible = false;
    view.wheels.forEach((g, i) => {
      const x = i % 2 ? -.82 : .82, z = i < 2 ? 1.32 : -1.32;
      g.position.set(x, -.1 - tune.rest + comp, z);
    });
    // apoia as rodas no piso da pré-visualização
    view.root.position.y = -.99 + .1 + tune.rest + .33 * tune.wheel - comp;
    this.holder.add(view.root);
  }

  private change(patch: Partial<CarConfig>) {
    Object.assign(this.config, patch);
    saveConfig(this.config);
    this.rebuild();
    this.renderUI();
  }

  private renderUI() {
    const c = this.config, p = this.panel;
    p.innerHTML = '';
    const section = (title: string) => {
      const s = document.createElement('section'), h = document.createElement('h3');
      h.textContent = title; s.append(h); p.append(s);
      return s;
    };
    const chips = <T,>(title: string, opts: [T, string][], on: (v: T) => boolean, click: (v: T) => void) => {
      const s = section(title), row = document.createElement('div');
      row.className = 'chips';
      for (const [v, label] of opts) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(on(v)));
        b.onclick = () => click(v);
        row.append(b);
      }
      s.append(row);
    };
    const swatches = (title: string, opts: number[], cur: number, click: (v: number) => void) => {
      const s = section(title), row = document.createElement('div');
      row.className = 'swatches';
      for (const v of opts) {
        const b = document.createElement('button');
        b.type = 'button'; b.style.background = hex(v); b.setAttribute('aria-label', hex(v)); b.setAttribute('aria-pressed', String(v === cur));
        b.onclick = () => click(v);
        row.append(b);
      }
      s.append(row);
    };
    const slider = (title: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const s = section(title), input = document.createElement('input'), out = document.createElement('output');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(val);
      input.setAttribute('aria-label', title);
      out.textContent = fmt(val);
      input.oninput = () => { out.textContent = fmt(+input.value); Object.assign(c, {}); set(+input.value); saveConfig(c); this.rebuild(); };
      s.querySelector('h3')!.append(out);
      s.append(input);
    };

    chips('Carroceria', BODIES, v => v === c.body, v => this.change({ body: v }));
    swatches('Cor', PAINTS, c.paint, v => this.change({ paint: v }));
    swatches('Detalhes', TRIMS, c.trim, v => this.change({ trim: v }));
    swatches('Rodas', RIMS, c.rim, v => this.change({ rim: v }));
    slider('Tamanho das rodas', .85, 1.6, .05, c.wheel, v => `${Math.round(v * 100)}%`, v => { c.wheel = v; });
    slider('Altura da suspensão', 0, .45, .01, c.lift, v => `+${Math.round(v * 100)} cm`, v => { c.lift = v; });
    chips('Suspensão', STIFF, v => v === c.stiffness, v => this.change({ stiffness: v }));
    chips('Acessórios', ACCESSORIES, v => c.accessories.includes(v), v => this.change({
      accessories: c.accessories.includes(v) ? c.accessories.filter(a => a !== v) : [...c.accessories, v],
    }));

    // apaga em dois toques: limpar é definitivo
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'reset'; reset.textContent = 'Começar do zero';
    reset.onclick = () => {
      if (reset.dataset.armed) {
        clearTimeout(this.confirmTimer);
        clearConfig();
        this.config = { ...DEFAULT_CONFIG, accessories: [] };
        this.rebuild(); this.renderUI();
        return;
      }
      reset.dataset.armed = '1'; reset.textContent = 'Toque de novo para apagar tudo';
      this.confirmTimer = window.setTimeout(() => { delete reset.dataset.armed; reset.textContent = 'Começar do zero'; }, 3500);
    };
    p.append(reset);
  }

  close() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
