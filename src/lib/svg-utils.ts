/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rasterizes a source (SVG or Image) to a JPG Blob, optionally hitting a target file size.
 * @param source The source image element (already loaded).
 * @param width Target width in pixels.
 * @param height Target height in pixels.
 * @param targetSizeMb Optional target file size in Megabytes.
 * @returns A Promise that resolves to a Blob (JPG).
 */
async function rasterizeToJpg(
  source: HTMLImageElement,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // High quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Set background to white for JPG
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(source, 0, 0, width, height);

  if (!targetSizeMb) {
    // Standard high quality output
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Rasterization failed'));
      }, 'image/jpeg', 0.95);
    });
  }

  // Target Size Logic (Iterative approach)
  const targetBytes = targetSizeMb * 1024 * 1024;
  let minQuality = 0.1;
  let maxQuality = 1.0;
  let bestBlob: Blob | null = null;
  
  // We try up to 5 iterations to find the sweet spot
  for (let i = 0; i < 5; i++) {
    const quality = (minQuality + maxQuality) / 2;
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    
    if (!blob) break;
    
    bestBlob = blob;
    
    if (Math.abs(blob.size - targetBytes) < targetBytes * 0.05) {
      break;
    }

    if (blob.size < targetBytes) {
      minQuality = quality;
    } else {
      maxQuality = quality;
    }
  }

  if (bestBlob) {
    if (bestBlob.size < targetBytes) {
      // Bloat the file: Append dummy data (null bytes) to reach exact target size
      const paddingSize = targetBytes - bestBlob.size;
      const padding = new Uint8Array(paddingSize);
      return new Blob([bestBlob, padding], { type: 'image/jpeg' });
    }
    return bestBlob;
  }
  
  throw new Error('Target size optimization failed');
}

/**
 * Converts an SVG string to a JPG Blob.
 */
export async function svgToJpg(
  svgCode: string,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let processedSvg = svgCode.trim();
    
    if (processedSvg.includes('<svg')) {
      processedSvg = processedSvg.replace(/\s(width|height)=["'][^"']*["']/g, '');
      processedSvg = processedSvg.replace('<svg', `<svg width="${width}" height="${height}"`);
    }

    const svgBlob = new Blob([processedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = async () => {
      try {
        // Essential: Small delay to ensure the browser has actually decoded the SVG
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const result = await rasterizeToJpg(img, width, height, targetSizeMb);
        URL.revokeObjectURL(url);
        resolve(result);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Converts an Image File to a JPG Blob with custom resolution and target size.
 */
export async function imageToJpg(
  file: File,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      try {
        // Essential: Small delay to ensure the browser has decoded the source
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const result = await rasterizeToJpg(img, width, height, targetSizeMb);
        URL.revokeObjectURL(url);
        resolve(result);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}
