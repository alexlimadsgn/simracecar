import type { Controls } from './car';

const keys = new Set<string>();
const touch = new Set<string>();
const once = new Set<string>();

addEventListener('keydown', e => {
  if (!e.repeat && ['KeyR', 'KeyC', 'KeyM', 'KeyN', 'KeyP', 'Escape'].includes(e.code)) once.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

export function bindTouch(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    const k = b.dataset.k!;
    const on = (e: Event) => { e.preventDefault(); touch.add(k); b.classList.add('on'); if (k === 'reset') once.add('KeyR'); };
    const off = () => { touch.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
}

export const pressed = (code: string) => once.delete(code);

export function readControls(): Controls {
  const k = (...c: string[]) => c.some(x => keys.has(x));
  let throttle = k('KeyW', 'ArrowUp') || touch.has('gas') ? 1 : 0;
  let brake = k('KeyS', 'ArrowDown') || touch.has('brake') ? 1 : 0;
  let steer = (k('KeyA', 'ArrowLeft') || touch.has('left') ? 1 : 0) - (k('KeyD', 'ArrowRight') || touch.has('right') ? 1 : 0);
  let handbrake = k('Space');
  const pad = navigator.getGamepads?.().find(p => p);
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > .08) steer = -ax * Math.abs(ax);
    throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
    brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
    handbrake = handbrake || !!pad.buttons[0]?.pressed;
  }
  return { throttle, brake, steer, handbrake };
}
