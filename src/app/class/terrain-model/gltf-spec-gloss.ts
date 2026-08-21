/**
 * Three.js r147+ dropped KHR_materials_pbrSpecularGlossiness.
 * Sketchfab / older exporters still emit it (often as extensionsRequired).
 * Convert diffuse → metal/rough so GLTFLoader can bind baseColor maps for bake.
 *
 * Specular / glossiness *textures* are not rewritten (would need image processing).
 * Factor-only + diffuseTexture covers typical building packs.
 */

const SPEC_GLOSS = 'KHR_materials_pbrSpecularGlossiness';

/** @returns true when the JSON was modified. */
export function convertSpecularGlossinessMaterials(json: any): boolean {
  if (!json || !Array.isArray(json.materials)) return false;
  const used: string[] = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
  if (!used.includes(SPEC_GLOSS) && !materialsHaveSpecGloss(json.materials)) return false;

  let changed = false;
  for (const mat of json.materials) {
    const sg = mat?.extensions?.[SPEC_GLOSS];
    if (!sg) continue;
    const pbr = mat.pbrMetallicRoughness || (mat.pbrMetallicRoughness = {});
    if (Array.isArray(sg.diffuseFactor) && pbr.baseColorFactor == null) {
      pbr.baseColorFactor = sg.diffuseFactor.slice();
    }
    if (sg.diffuseTexture && pbr.baseColorTexture == null) {
      pbr.baseColorTexture = { ...sg.diffuseTexture };
    }
    if (pbr.metallicFactor == null) pbr.metallicFactor = 0;
    if (pbr.roughnessFactor == null && typeof sg.glossinessFactor === 'number') {
      pbr.roughnessFactor = Math.min(1, Math.max(0, 1 - sg.glossinessFactor));
    }
    delete mat.extensions[SPEC_GLOSS];
    if (mat.extensions && !Object.keys(mat.extensions).length) delete mat.extensions;
    changed = true;
  }

  if (Array.isArray(json.extensionsUsed)) {
    json.extensionsUsed = json.extensionsUsed.filter((x: string) => x !== SPEC_GLOSS);
    if (!json.extensionsUsed.length) delete json.extensionsUsed;
  }
  if (Array.isArray(json.extensionsRequired)) {
    json.extensionsRequired = json.extensionsRequired.filter((x: string) => x !== SPEC_GLOSS);
    if (!json.extensionsRequired.length) delete json.extensionsRequired;
  }
  return changed;
}

function materialsHaveSpecGloss(materials: any[]): boolean {
  return materials.some(m => m?.extensions?.[SPEC_GLOSS]);
}
