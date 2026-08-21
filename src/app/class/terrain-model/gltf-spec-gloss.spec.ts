import { convertSpecularGlossinessMaterials } from './gltf-spec-gloss';

describe('convertSpecularGlossinessMaterials', () => {
  it('maps diffuseTexture / factors to metal-rough and clears the extension', () => {
    const json: any = {
      extensionsUsed: ['KHR_materials_pbrSpecularGlossiness'],
      extensionsRequired: ['KHR_materials_pbrSpecularGlossiness'],
      materials: [{
        name: 'brick',
        extensions: {
          KHR_materials_pbrSpecularGlossiness: {
            diffuseFactor: [1, 1, 1, 1],
            diffuseTexture: { index: 0 },
            glossinessFactor: 0.6,
            specularFactor: [0.04, 0.04, 0.04],
          },
        },
      }],
    };

    expect(convertSpecularGlossinessMaterials(json)).toBeTrue();
    expect(json.materials[0].pbrMetallicRoughness).toEqual({
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: 0 },
      metallicFactor: 0,
      roughnessFactor: 0.4,
    });
    expect(json.materials[0].extensions).toBeUndefined();
    expect(json.extensionsUsed).toBeUndefined();
    expect(json.extensionsRequired).toBeUndefined();
  });

  it('is a no-op for metal-rough-only assets', () => {
    const json: any = {
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    };
    expect(convertSpecularGlossinessMaterials(json)).toBeFalse();
  });
});
