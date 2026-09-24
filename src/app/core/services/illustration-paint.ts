/**
 * Cálculo del repintado de ilustraciones, sin Angular ni DOM, para poder
 * probarlo fuera del navegador. Ver IllustrationPainter.
 */
/** Lo mínimo de ImageData, para poder probar el cálculo fuera del navegador. */
interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Analysis {
  image: Pixels;
  /** Cuánto de pintura tiene cada píxel, de 0 a 1. */
  weight: Float32Array;
  lightness: Float32Array;
  /** Luminosidad media de la pintura: referencia para sus luces y sombras. */
  baseLightness: number;
}


export function analysePixels(image: Pixels): Analysis {
  const { data } = image;
  const pixels = data.length / 4;
  const hue = new Float32Array(pixels);
  const chroma = new Float32Array(pixels);
  const lightness = new Float32Array(pixels);

  // El tono de la pintura se mide en vez de suponerlo: el modelo no siempre
  // clava el verde que se le pide.
  const histogram = new Uint32Array(360);
  for (let i = 0; i < pixels; i++) {
    const [h, c, l] = hcl(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    hue[i] = h;
    chroma[i] = c;
    lightness[i] = l;
    if (c > 0.25) histogram[Math.floor(h) % 360]++;
  }
  const baseHue = histogram.indexOf(Math.max(...histogram));

  const weight = new Float32Array(pixels);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels; i++) {
    const diff = Math.abs(hue[i] - baseHue) % 360;
    const distance = Math.min(diff, 360 - diff);
    // Croma, no saturación: la saturación se dispara en blancos con algo de
    // ruido del JPEG. El umbral bajo recoge los bordes suavizados.
    const w = clamp((chroma[i] - 0.1) / 0.12) * clamp(1 - (distance - 22) / 14);
    weight[i] = w;
    if (w > 0.9) {
      sum += lightness[i];
      count++;
    }
  }

  return { image, weight, lightness, baseLightness: count ? sum / count : 0.5 };
}


/** Copia de los píxeles con la pintura cambiada a `color` (hex). */
export function paintPixels(analysis: Analysis, color: string): Uint8ClampedArray<ArrayBuffer> {
  const { image, weight, lightness, baseLightness } = analysis;
  const [targetHue, targetSaturation, targetLightness] = hexToHsl(color);
  // En colores muy claros u oscuros las sombras se suavizan, o el blanco
  // saldría gris y el negro, quemado.
  const contrast = targetLightness > 0.85 ? 0.6 : targetLightness < 0.2 ? 0.7 : 1;

  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < weight.length; i++) {
    const w = weight[i];
    if (w <= 0) continue;
    const l = clamp(targetLightness + (lightness[i] - baseLightness) * contrast, 0.02, 0.98);
    const [r, g, b] = hslToRgb(targetHue, targetSaturation, l);
    const k = i * 4;
    data[k] = data[k] * (1 - w) + r * w;
    data[k + 1] = data[k + 1] * (1 - w) + g * w;
    data[k + 2] = data[k + 2] * (1 - w) + b * w;
  }
  return data;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Tono (0-360), croma (0-1) y luminosidad HSL (0-1). */
function hcl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, d, l];
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
