import { XmlUtil } from '@udonarium/core/system/util/xml-util';

const IMAGE_ID_ATTRS = [
  'imageIdentifier',
  'toImageIdentifier',
  'backgroundImageIdentifier',
  'backgroundImageIdentifier2',
] as const;

/** Remap image id strings inside JSON SyncVar values (token FX, combat, scene snaps). */
export function remapIdsInJson(value: any, idRemap: Map<string, string>): any {
  if (typeof value === 'string') {
    return idRemap.has(value) ? idRemap.get(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(v => remapIdsInJson(v, idRemap));
  }
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const key of Object.keys(value)) {
      out[key] = remapIdsInJson(value[key], idRemap);
    }
    return out;
  }
  return value;
}

/**
 * Rewrite image ids in exported XML after materializing asset URLs to content hashes.
 * Uses DOM walk — never global string replace (that can corrupt coordinates).
 */
export function remapImageIdentifiers(xml: string, idRemap: Map<string, string>): string {
  if (!xml || !idRemap.size) return xml;
  const root = XmlUtil.xml2element(xml);
  if (!root || !root.ownerDocument) {
    // Fallback: never use global replace (can corrupt coordinates / unrelated text).
    return xml;
  }
  const doc = root.ownerDocument;

  const mapId = (id: string | null): string | null => {
    if (!id) return id;
    return idRemap.has(id) ? idRemap.get(id) : id;
  };

  for (const node of Array.from(doc.querySelectorAll('*[type="image"]'))) {
    const text = (node.textContent || '').trim();
    if (text && idRemap.has(text)) node.textContent = idRemap.get(text);
    const cv = node.getAttribute('currentValue');
    const mappedCv = mapId(cv);
    if (cv && mappedCv && cv !== mappedCv) node.setAttribute('currentValue', mappedCv);
  }

  for (const attr of IMAGE_ID_ATTRS) {
    for (const node of Array.from(doc.querySelectorAll(`*[${attr}]`))) {
      const v = node.getAttribute(attr);
      const mapped = mapId(v);
      if (v && mapped && v !== mapped) node.setAttribute(attr, mapped);
    }
  }

  for (const node of Array.from(doc.querySelectorAll('*[attachedImageIdentifiers]'))) {
    const v = node.getAttribute('attachedImageIdentifiers');
    if (!v) continue;
    const next = v.trim().split(/\s+/).map(id => mapId(id) || id).join(' ');
    if (next !== v) node.setAttribute('attachedImageIdentifiers', next);
  }

  // image-tag identifiers are imagetag_<imageId>
  for (const node of Array.from(doc.querySelectorAll('image-tag'))) {
    const syncId = node.getAttribute('syncId');
    if (syncId && syncId.startsWith('imagetag_')) {
      const imgId = syncId.slice('imagetag_'.length);
      if (idRemap.has(imgId)) {
        node.setAttribute('syncId', 'imagetag_' + idRemap.get(imgId));
      }
    }
    const imgAttr = node.getAttribute('imageIdentifier');
    const mappedImg = mapId(imgAttr);
    if (imgAttr && mappedImg && imgAttr !== mappedImg) {
      node.setAttribute('imageIdentifier', mappedImg);
    }
  }

  // JSON SyncVars that may embed image ids (token FX, combat entries, scene snaps).
  for (const node of Array.from(doc.querySelectorAll('*'))) {
    if (!node.attributes) continue;
    for (const attr of Array.from(node.attributes)) {
      const raw = attr.value;
      if (!raw || (raw[0] !== '{' && raw[0] !== '[')) continue;
      try {
        const parsed = JSON.parse(raw);
        const next = remapIdsInJson(parsed, idRemap);
        const serialized = JSON.stringify(next);
        if (serialized !== raw) node.setAttribute(attr.name, serialized);
      } catch {
        /* not JSON */
      }
    }
  }

  const declaration = xml.trimStart().startsWith('<?xml')
    ? xml.slice(0, xml.indexOf('?>') + 2) + '\n'
    : '';
  return declaration + new XMLSerializer().serializeToString(root);
}
