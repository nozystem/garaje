import { Injectable } from '@angular/core';

/** Lado mayor al que se reduce la foto antes de guardarla. */
const MAX_SIDE = 900;

/** Calidad JPEG. 0.72 mantiene buen aspecto con un peso razonable. */
const QUALITY = 0.72;

/** Tope duro: por encima, la petición se rechazaría en el servidor. */
const MAX_BYTES = 250_000;

@Injectable({ providedIn: 'root' })
export class PhotoService {
  /**
   * Convierte el archivo elegido en un JPEG reducido y en base64.
   *
   * Se redimensiona en el navegador antes de subir: una foto de móvil pesa
   * varios megas y guardarla entera en la base de datos sería un despilfarro,
   * además de hacer lenta la carga del garaje. A 900 px se ve bien en la ficha
   * y baja a unos 100 KB.
   */
  async process(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
      throw new Error('El archivo no es una imagen.');
    }

    const bitmap = await this.decode(file);
    const { width, height } = this.fit(bitmap.width, bitmap.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se ha podido procesar la imagen.');
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

    // Si aun así pesa de más (fotos muy detalladas), se baja la calidad.
    let quality = QUALITY;
    while (dataUrl.length > MAX_BYTES && quality > 0.35) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > MAX_BYTES) {
      throw new Error('La imagen es demasiado grande, prueba con otra.');
    }

    return dataUrl;
  }

  private async decode(file: File): Promise<ImageBitmap> {
    // createImageBitmap respeta la orientación EXIF, cosa que <img> no
    // siempre hace: sin esto las fotos verticales salen tumbadas.
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        // Algunos navegadores no admiten la opción: se sigue por el camino largo.
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

  /** Escala manteniendo la proporción; nunca amplía. */
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
