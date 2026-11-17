import * as THREE from 'three';
import { box, material, mesh, sphere } from './primitives.js';

/** Furniture is independent from the Agent skeleton and can be reused. */
export class Desk extends THREE.Group {
  constructor(color) {
    super();
    const white = material('#f9f9f7');
    const legs = material('#e8e9e6', { metalness: 0.2 });
    const silver = material('#bfc3c2', { metalness: 0.55, roughness: 0.45 });
    const black = material('#282c2d');
    box(this, [2.65, 0.12, 1.22], [0, 1.31, 0], white);
    for (const x of [-1.12, 1.12]) for (const z of [-0.43, 0.43]) {
      box(this, [0.07, 1.21, 0.07], [x, 0.64, z], legs, 0.015);
    }
    box(this, [0.62, 0.86, 0.86], [0.82, 0.76, -0.07], white);
    for (const y of [0.65, 0.94]) {
      box(this, [0.58, 0.012, 0.01], [0.82, y, 0.368], legs, 0.003);
      box(this, [0.13, 0.02, 0.025], [0.82, y + 0.1, 0.38], silver, 0.004);
    }
    // Display faces +Z, towards the character and the fixed camera.
    box(this, [0.43, 0.025, 0.28], [-0.24, 1.392, -0.25], silver);
    box(this, [0.055, 0.22, 0.05], [-0.24, 1.49, -0.32], silver, 0.012);
    box(this, [1.06, 0.65, 0.065], [-0.24, 1.9, -0.34], black, 0.035);
    this.screenMaterial = material('#19282e', { emissive: color, emissiveIntensity: 0.14, roughness: 0.4 });
    box(this, [0.98, 0.56, 0.012], [-0.24, 1.915, -0.301], this.screenMaterial, 0.012);
    const line = material(color, { emissive: color, emissiveIntensity: 0.25 });
    for (let i = 0; i < 4; i++) {
      box(this, [0.25 + i % 2 * 0.28, 0.018, 0.008], [-0.42 + i % 2 * 0.09, 2.06 - i * 0.09, -0.289], line, 0.002);
    }
    box(this, [0.7, 0.025, 0.25], [-0.24, 1.39, 0.22], legs, 0.02);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) {
      box(this, [0.052, 0.009, 0.045], [-0.51 + col * 0.067, 1.408, 0.15 + row * 0.065], white, 0.004);
    }
    sphere(this, 0.07, [0.34, 1.414, 0.24], white, [0.7, 0.35, 1]);
    // White ergonomic office chair, a darker back to frame the black character.
    const chair = new THREE.Group();
    chair.position.set(-0.24, 0, 0.97);
    this.add(chair);
    box(chair, [0.69, 0.12, 0.62], [0, 0.78, 0], white, 0.08);
    box(chair, [0.68, 0.65, 0.10], [0, 1.12, 0.3], legs, 0.08);
    box(chair, [0.07, 0.56, 0.07], [0, 0.45, 0], silver, 0.02);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      const leg = box(chair, [0.42, 0.045, 0.045], [Math.cos(angle) * 0.18, 0.17, Math.sin(angle) * 0.18], silver, 0.015);
      leg.rotation.y = -angle;
      mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.055, 12), black, [Math.cos(angle) * 0.39, 0.1, Math.sin(angle) * 0.39], chair).rotation.z = Math.PI / 2;
    }
    for (const side of [-1, 1]) {
      box(chair, [0.05, 0.25, 0.05], [side * 0.4, 0.91, 0], silver, 0.012);
      box(chair, [0.1, 0.05, 0.34], [side * 0.4, 1.05, -0.03], white, 0.02);
    }
  }

  setState(state) {
    this.screenMaterial.emissiveIntensity = { idle: 0.08, thinking: 0.22, working: 0.35, completed: 0.5 }[state];
  }
}
