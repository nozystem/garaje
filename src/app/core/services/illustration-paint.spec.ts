import { describe, expect, it } from 'vitest';

import { analysePixels, paintPixels } from './illustration-paint';

/** Una imagen de 1×n con los colores dados, como la entrega un canvas. */
function image(...pixels: [number, number, number][]) {
  const data = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  return { data, width: pixels.length, height: 1 };
}

const GREEN: [number, number, number] = [0, 200, 83];
const GREY: [number, number, number] = [110, 110, 110];
const TAIL_LIGHT: [number, number, number] = [220, 40, 30];

describe('paintPixels', () => {
  const analysis = analysePixels(image(GREEN, GREEN, GREEN, GREY, TAIL_LIGHT));

  it('repaints the green body in the chosen colour', () => {
    const [r, g, b] = paintPixels(analysis, '#4d9de0');
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('leaves grey parts and red tail lights alone', () => {
    const out = paintPixels(analysis, '#4d9de0');
    expect([...out.slice(12, 15)]).toEqual(GREY);
    expect([...out.slice(16, 19)]).toEqual(TAIL_LIGHT);
  });

  it('can paint the body white or black', () => {
    expect(paintPixels(analysis, '#f4f4f4')[0]).toBeGreaterThan(220);
    expect(paintPixels(analysis, '#1f2023')[0]).toBeLessThan(50);
  });
});
