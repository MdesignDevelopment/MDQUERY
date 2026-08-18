import type { Geometry } from 'geojson';

/**
 * Render a GeoJSON geometry as WKT matching QGIS's `geom_to_wkt($geometry)`
 * output (the format users currently produce by hand: QGIS -> import shapefile
 * -> run geom_to_wkt($geometry) -> paste into the value cell).
 *
 * Two QGIS/OGR quirks this replicates:
 * - Numbers are rounded to 8 decimal places with trailing zeros trimmed
 *   (QGIS's default geom_to_wkt precision), not zero-padded.
 * - The ESRI shapefile format has no distinct "Polygon" vs "MultiPolygon" (or
 *   "PolyLine" vs "MultiLineString") shape type — a single record can hold
 *   multiple rings/parts — so OGR/QGIS always reports Polygon-type shapefiles
 *   as MultiPolygon and PolyLine-type as MultiLineString, even for a
 *   single-part feature. We promote to match.
 */
function fmtNum(n: number): string {
  return String(Number(n.toFixed(8)));
}

function fmtPoint(c: number[]): string {
  return `${fmtNum(c[0])} ${fmtNum(c[1])}`;
}

function fmtLine(coords: number[][]): string {
  return `(${coords.map(fmtPoint).join(', ')})`;
}

function fmtPolygon(rings: number[][][]): string {
  return `(${rings.map(fmtLine).join(', ')})`;
}

function fmtMultiPolygon(polys: number[][][][]): string {
  return `(${polys.map(fmtPolygon).join(', ')})`;
}

export function geometryToWkt(geom: Geometry): string {
  switch (geom.type) {
    case 'Point':
      return `Point (${fmtPoint(geom.coordinates)})`;
    case 'MultiPoint':
      return `MultiPoint (${geom.coordinates.map((c) => `(${fmtPoint(c)})`).join(', ')})`;
    case 'LineString':
      return `MultiLineString (${fmtLine(geom.coordinates)})`;
    case 'MultiLineString':
      return `MultiLineString (${geom.coordinates.map(fmtLine).join(', ')})`;
    case 'Polygon':
      return `MultiPolygon (${fmtPolygon(geom.coordinates)})`;
    case 'MultiPolygon':
      return `MultiPolygon ${fmtMultiPolygon(geom.coordinates)}`;
    default:
      throw new Error(`Unsupported geometry type: ${geom.type}`);
  }
}

/** Pick a human-readable label for a parsed feature from its attribute table, if any. */
export function featureLabel(index: number, properties: Record<string, unknown> | null): string {
  if (properties) {
    for (const key of Object.keys(properties)) {
      const v = properties[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
  }
  return `Feature ${index + 1}`;
}
