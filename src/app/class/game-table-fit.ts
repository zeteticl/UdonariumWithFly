import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { EventSystem } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 100;

/** Load natural pixel size of an ImageFile (url or blob). */
export function loadImageNaturalSize(image: ImageFile): Promise<{ width: number; height: number } | null> {
  if (!image || image.isEmpty) return Promise.resolve(null);
  const src = image.url;
  if (!src) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Resize table grid (cells) to match map image aspect / pixel size at current gridSize.
 * Clamps to [min, max] while preserving aspect when one side would exceed max.
 */
export async function fitGameTableSizeToImage(
  table: GameTable,
  image: ImageFile,
  opts?: { min?: number; max?: number },
): Promise<boolean> {
  if (!table || !image || image.isEmpty) return false;
  const size = await loadImageNaturalSize(image);
  if (!size) return false;

  const min = opts?.min ?? DEFAULT_MIN;
  const max = opts?.max ?? DEFAULT_MAX;
  const grid = Math.max(1, table.gridSize || 50);

  let w = Math.round(size.width / grid);
  let h = Math.round(size.height / grid);
  if (w < 1 && h < 1) return false;

  const scale = Math.min(1, max / Math.max(w, h, 1));
  w = Math.max(min, Math.min(max, Math.round(w * scale)));
  h = Math.max(min, Math.min(max, Math.round(h * scale)));

  if (table.width === w && table.height === h) return false;
  table.width = w;
  table.height = h;
  // ObjectStore coalesces SyncVar UPDATEs in one tick — only the first (often
  // imageIdentifier) notifies listeners, so the map keeps the old pixel size
  // until the next table switch. Force a local refresh with final dimensions.
  EventSystem.trigger('UPDATE_GAME_OBJECT', table.toContext());
  return true;
}
