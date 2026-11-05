// Acumulador de triângulos com sombreamento flat e cor sólida por face.

export type V3 = [number, number, number];

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  /** triângulos que também viram colisão */
  solid: number[] = [];
  collide = false;
  /** objetos derrubáveis: tipo, x, y, z, rumo */
  props: number[] = [];

  tri(a: V3, b: V3, c: V3, color: number | V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const [r, g, bl] = typeof color === 'number' ? [(color >> 16) & 255, (color >> 8) & 255, color & 255] : color;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.nor.push(nx, ny, nz); this.col.push(r, g, bl); }
    if (this.collide) this.solid.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: number | V3) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Caixa com base em y0; `yaw` gira em torno de Y. A face inferior é omitida. */
  box(cx: number, y0: number, cz: number, hx: number, h: number, hz: number, color: number, yaw = 0) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const p = (x: number, y: number, z: number): V3 => [cx + x * co + z * si, y0 + y, cz - x * si + z * co];
    const a = p(-hx, 0, -hz), b = p(hx, 0, -hz), c = p(hx, 0, hz), d = p(-hx, 0, hz);
    const e = p(-hx, h, -hz), f = p(hx, h, -hz), g = p(hx, h, hz), i = p(-hx, h, hz);
    this.quad(e, i, g, f, color);
    this.quad(a, e, f, b, color); this.quad(b, f, g, c, color);
    this.quad(c, g, i, d, color); this.quad(d, i, e, a, color);
  }

  /** Prisma/tronco de n lados, com tampa superior. */
  prism(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, n: number, color: number, side = color, phase = 0) {
    const top: V3 = [cx, y0 + h, cz];
    for (let k = 0; k < n; k++) {
      const a0 = phase + (k / n) * Math.PI * 2, a1 = phase + ((k + 1) / n) * Math.PI * 2;
      const b0: V3 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], b1: V3 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const t0: V3 = [cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1], t1: V3 = [cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1];
      this.quad(b0, t0, t1, b1, side);
      if (r1 > 0.01) this.tri(top, t1, t0, color);
    }
  }
}
