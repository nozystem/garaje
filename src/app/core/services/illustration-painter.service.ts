import { Injectable } from '@angular/core';

import { Analysis, analysePixels, paintPixels } from './illustration-paint';

/**
 * Pinta las ilustraciones con el color de cada coche.
 *
 * El servidor las genera con la carrocería en un verde intenso que no lleva
 * ninguna otra pieza del coche. Aquí se cambia el tono de esos píxeles al
 * color elegido, conservando sus luces y sombras; cristales, llantas, pilotos
 * y fondo no tienen ese verde y se quedan como están. Así cambiar el color es
 * instantáneo y no genera otra imagen.
 */
@Injectable({ providedIn: 'root' })
export class IllustrationPainter {
  /** Píxeles de la ilustración ya analizados, por URL. */
  private readonly analysed = new Map<string, Promise<Analysis>>();
  /** Resultados ya pintados, por URL y color. */
  private readonly painted = new Map<string, Promise<string>>();

  /** Devuelve la URL de la ilustración pintada de `color` (hex). */
  paint(src: string, color: string): Promise<string> {
    const key = `${src}|${color.toLowerCase()}`;
    let result = this.painted.get(key);
    if (!result) {
      result = this.analyse(src).then((analysis) => render(analysis, color));
      result.catch(() => this.painted.delete(key));
      this.painted.set(key, result);
    }
    return result;
  }

  private analyse(src: string): Promise<Analysis> {
    let result = this.analysed.get(src);
    if (!result) {
      result = loadPixels(src).then(analysePixels);
      result.catch(() => this.analysed.delete(src));
      this.analysed.set(src, result);
    }
    return result;
  }
}

async function loadPixels(src: string): Promise<ImageData> {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is not available');
  context.drawImage(img, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function render(analysis: Analysis, color: string): Promise<string> {
  const { width, height } = analysis.image;
  const out = new ImageData(paintPixels(analysis, color), width, height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not paint the illustration');
  return URL.createObjectURL(blob);
}
