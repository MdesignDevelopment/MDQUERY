import * as shapefile from 'shapefile';
import JSZip from 'jszip';
import { handler, json } from '@/lib/api';
import { HttpError } from '@/lib/store';
import { geometryToWkt, featureLabel } from '@/lib/geometry';

/**
 * Parses an uploaded shapefile (.zip bundle or bare .shp) and returns each
 * feature's geometry as WKT — automating the manual QGIS workflow (import
 * shapefile -> geom_to_wkt($geometry) -> paste into the value cell) for
 * `geometry`-typed query variables. Stateless: nothing is persisted, any
 * authenticated user may use it.
 */
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FEATURES = 500;

export const POST = handler(async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file provided.');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'File too large (max 20 MB).');

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let shpBuf: Buffer;
  let dbfBuf: Buffer | undefined;

  if (name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buf).catch(() => {
      throw new HttpError(400, 'Could not read that zip file.');
    });
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const shpEntry = entries.find((f) => f.name.toLowerCase().endsWith('.shp'));
    if (!shpEntry) throw new HttpError(400, 'The zip file does not contain a .shp file.');
    const base = shpEntry.name.toLowerCase().slice(0, -4);
    const dbfEntry = entries.find((f) => f.name.toLowerCase() === `${base}.dbf`);
    shpBuf = Buffer.from(await shpEntry.async('arraybuffer'));
    if (dbfEntry) dbfBuf = Buffer.from(await dbfEntry.async('arraybuffer'));
  } else if (name.endsWith('.shp')) {
    shpBuf = buf;
  } else {
    throw new HttpError(400, 'Upload a .zip containing the shapefile (.shp, .dbf, ...), or a bare .shp file.');
  }

  const source = await shapefile.open(shpBuf, dbfBuf).catch(() => {
    throw new HttpError(400, 'Could not read the shapefile — the file may be corrupt or not a valid ESRI shapefile.');
  });

  const features: { index: number; label: string; wkt: string }[] = [];
  let index = 0;
  let result = await source.read();
  while (!result.done && index < MAX_FEATURES) {
    if (result.value.geometry) {
      try {
        const wkt = geometryToWkt(result.value.geometry);
        features.push({ index, label: featureLabel(index, result.value.properties), wkt });
      } catch {
        // unsupported geometry type on this record — skip it, keep the rest
      }
    }
    index++;
    result = await source.read();
  }

  if (features.length === 0) throw new HttpError(400, 'No usable geometry found in that shapefile.');

  return json({ features, truncated: !result.done });
});
