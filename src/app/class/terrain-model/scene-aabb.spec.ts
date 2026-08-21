import * as THREE from 'three';

import {
  hidePhotoSkippedMeshes,
  isDegenerateExtent,
  isLikelyProbeExtent,
  shortestInterval,
  shouldSkipPhotoMeshName,
  solidMeshAabb,
} from './scene-aabb';

describe('shouldSkipPhotoMeshName', () => {
  it('drops Sketchfab / FBX animation control meshes', () => {
    expect(shouldSkipPhotoMeshName('ESC_Door_Ctrl')).toBeTrue();
    expect(shouldSkipPhotoMeshName('ESC_Door_Ctrl_Material_#286_0')).toBeTrue();
    expect(shouldSkipPhotoMeshName('Wheel04_Ctrl')).toBeTrue();
    expect(shouldSkipPhotoMeshName('Sphere')).toBeTrue();
    expect(shouldSkipPhotoMeshName('T_MRTIsland_BodyEXT')).toBeFalse();
  });
});

describe('isDegenerateExtent', () => {
  it('treats a zero-thickness plane as degenerate', () => {
    expect(isDegenerateExtent(317, 289, 0)).toBeTrue();
    expect(isDegenerateExtent(122, 143, 926)).toBeFalse();
  });
});

describe('shortestInterval', () => {
  it('drops a few far outliers', () => {
    const values: number[] = [];
    for (let i = 0; i < 100; i++) values.push(i * 0.1);
    values.push(80, 90, 100);
    const [lo, hi] = shortestInterval(values, 0.97);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(20);
  });
});

describe('isLikelyProbeExtent', () => {
  it('flags a small icosphere next to a building-sized mesh', () => {
    expect(isLikelyProbeExtent(1, 1, 1, 320, 40)).toBeTrue();
    expect(isLikelyProbeExtent(30, 12, 20, 8000, 40)).toBeFalse();
  });
});

describe('hidePhotoSkippedMeshes', () => {
  it('hides SphereGeometry light probes', () => {
    const scene = new THREE.Scene();
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
    body.name = 'Body';
    scene.add(body);
    const probe = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12));
    probe.name = 'Sphere';
    scene.add(probe);
    hidePhotoSkippedMeshes(scene);
    expect(probe.visible).toBeFalse();
    expect(body.visible).toBeTrue();
  });
});

describe('solidMeshAabb', () => {
  it('ignores a huge zero-thickness Ctrl plane around a unit cube', () => {
    const scene = new THREE.Scene();
    const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    cube.name = 'Body';
    scene.add(cube);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40));
    plane.name = 'ESC_Door_Ctrl';
    scene.add(plane);
    scene.updateMatrixWorld(true);

    const aabb = solidMeshAabb(THREE, scene);
    expect(aabb.max[0] - aabb.min[0]).toBeCloseTo(2, 4);
    expect(aabb.max[1] - aabb.min[1]).toBeCloseTo(2, 4);
    expect(aabb.max[2] - aabb.min[2]).toBeCloseTo(2, 4);
  });
});
