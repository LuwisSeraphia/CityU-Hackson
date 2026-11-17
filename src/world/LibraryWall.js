import * as THREE from 'three';
import { box, material } from './primitives.js';

export class LibraryWall extends THREE.Group {
  constructor() {
    super(); this.name = 'RAG 知识书墙'; this.position.set(5, 0, -2.4);
    // Parallel to the right floor edge; the book-facing side points inward.
    this.rotation.y = -Math.PI / 2;
    const front = new THREE.Vector3(-1, 0, 0);
    const wood = material('#e2dfd3'), white = material('#fafaf6');
    box(this, [4.75, 2.9, 0.12], [0, 1.45, -0.28], wood);
    for (const x of [-2.4, 2.4]) box(this, [0.1, 3.05, 0.65], [x, 1.52, 0], white);
    for (const y of [0.12, 0.85, 1.58, 2.31, 3.02]) box(this, [4.9, 0.08, 0.65], [0, y, 0], white);
    const colors = ['#83b4ae', '#b2a0ce', '#a8b48e', '#c8b498', '#b0c0cd'];
    for (let row = 0; row < 4; row++) for (let i = 0; i < 16; i++) {
      const height = 0.42 + (i % 3) * 0.055;
      box(this, [0.18, height, 0.4], [-2.15 + i * 0.28, 0.16 + row * 0.73 + height / 2, 0.02], material(colors[(i + row) % colors.length]), 0.01);
      box(this, [0.12, 0.025, 0.009], [-2.15 + i * 0.28, 0.35 + row * 0.73, 0.225], white, 0.002);
    }
    this.destination = this.position.clone().addScaledVector(front, 0.95);
    this.pickupYaw = this.rotation.y + Math.PI;
    this.labelAnchor = new THREE.Vector3(5, 3.5, -2.4);
  }
}
