import { Injectable } from '@angular/core';

const MAX_SIDE = 900;

const QUALITY = 0.72;

const MAX_BYTES = 250_000;

@Injectable({ providedIn: 'root' })
export class PhotoService {
  async process(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
      throw new Error('That file is not an image.');
    }

    const bitmap = await this.decode(file);
    const { width, height } = this.fit(bitmap.width, bitmap.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('The image could not be processed.');
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

    let quality = QUALITY;
    while (dataUrl.length > MAX_BYTES && quality > 0.35) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > MAX_BYTES) {
      throw new Error('The image is too large, try another one.');
    }

    return dataUrl;
  }

  private async decode(file: File): Promise<ImageBitmap> {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private fit(width: number, height: number): { width: number; height: number } {
    const largest = Math.max(width, height);
    if (largest <= MAX_SIDE) {
      return { width, height };
    }
    const ratio = MAX_SIDE / largest;
    return {
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    };
  }
}
