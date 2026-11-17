import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...extra });

export function mesh(geometry, surface, position = [0, 0, 0], parent) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent?.add(object);
  return object;
}

export function box(parent, size, position, surface, radius = 0.03) {
  return mesh(new RoundedBoxGeometry(...size, 2, radius), surface, position, parent);
}

export function sphere(parent, radius, position, surface, scale = [1, 1, 1]) {
  const object = mesh(new THREE.SphereGeometry(radius, 24, 16), surface, position, parent);
  object.scale.set(...scale);
  return object;
}

/** One procedural texture shared by all soft contact shadows. */
export function createContactTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(49,45,40,0.24)');
  gradient.addColorStop(0.45, 'rgba(49,45,40,0.12)');
  gradient.addColorStop(1, 'rgba(49,45,40,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function contactShadow(parent, texture, x, z, width, depth) {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(x, 0.012, z);
  parent.add(shadow);
}
