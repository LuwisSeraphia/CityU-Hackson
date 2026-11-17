import * as THREE from 'three';
import { material, mesh, sphere, box } from './primitives.js';

/** All animation targets are evaluated then exponentially blended using delta time. */
export class Agent {
  constructor(definition, onCelebrationEnd = () => {}) {
    this.id = definition.id;
    this.state = definition.state;
    this.phase = { browser: 0.3, computer: 2.4, file: 4.6 }[this.id];
    this.elapsed = 0;
    this.stateTime = 0;
    this.onCelebrationEnd = onCelebrationEnd;
    this.group = new THREE.Group();
    this.group.name = definition.name;
    this.group.userData.agentId = this.id;
    this.group.position.set(definition.position[0] - 0.24, 0, definition.position[2] + 0.87);
    this.homePosition = this.group.position.clone();
    this.group.rotation.y = Math.PI;
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    const black = material('#17191a', { roughness: 0.62 });
    const white = material('#f7f7f4', { roughness: 0.8 });
    const noseMaterial = material('#101112', { roughness: 0.28 });
    this.accent = material(definition.color, { emissive: definition.color, emissiveIntensity: 0.04 });

    // Liu Kanshan proportions follow the supplied three-view reference:
    // a soft white upright body, two ears, prominent dark nose, black arms and feet.
    this.body = sphere(this.rig, 1, [0, 1.14, 0], white, [0.39, 0.64, 0.34]);
    this.head = new THREE.Group();
    this.head.position.set(0, 1.86, 0.01);
    this.rig.add(this.head);
    // Body and head share the monitor-facing -Z orientation at the desk.
    this.head.rotation.y = 0;
    sphere(this.head, 0.36, [0, 0.02, 0], white, [0.92, 1.1, 0.88]);
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.14, 0.43, 20), white, [side * 0.21, 0.39, -0.015], this.head);
      ear.rotation.z = side * -0.13;
    }
    sphere(this.head, 0.185, [0, -0.075, 0.3], noseMaterial, [1.04, 0.9, 0.86]);
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.245, 0.09, 0.225);
      this.head.add(eye);
      sphere(eye, 0.055, [0, 0, 0], noseMaterial, [0.78, 1.12, 0.6]);
      this.eyes.push(eye);
    }
    this.arms = [-1, 1].map(side => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.34, 1.35, 0.035);
      pivot.rotation.z = side * 0.1;
      this.rig.add(pivot);
      sphere(pivot, 0.09, [side * 0.055, -0.19, 0], black, [0.78, 2.2, 0.85]);
      sphere(pivot, 0.09, [side * 0.08, -0.36, 0.025], black, [0.95, 0.72, 0.9]);
      return pivot;
    });
    this.legs = [-1, 1].map(side => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.16, 0.56, 0.02);
      this.rig.add(leg);
      sphere(leg, 0.105, [0, -0.09, 0], black, [0.8, 1.35, 0.85]);
      sphere(leg, 0.13, [0, -0.2, 0.1], black, [0.95, 0.72, 1.35]);
      return leg;
    });
    sphere(this.rig, 0.17, [0, 0.95, -0.32], white, [0.9, 0.9, 1]);
    this.book = box(this.rig, [0.28, 0.4, 0.09], [0.25, 1.22, 0.35], this.accent, 0.015);
    this.book.visible = false;
    this.trip = null;
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: definition.color, transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.51, 0.55, 48), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.022;
    this.group.add(this.ring);
    this.highlighted = false;
    this.selected = false;
    this.labelAnchor = new THREE.Vector3(this.group.position.x, 2.5, this.group.position.z);
    this.pose = { y: 0, tilt: 0, headX: 0, headY: 0, left: 0.15, right: 0.15, leftZ: -0.12, rightZ: 0.12 };
  }

  setState(state) {
    if (this.state === state) return;
    if (this.trip && (this.trip.kind === 'wander' || ['idle', 'completed'].includes(state))) this.trip.finish(false);
    this.state = state;
    this.stateTime = 0;
  }

  playIdleAnimation(t) {
    return { y: Math.sin(t * 1.7) * 0.014, tilt: Math.sin(t * 0.9) * 0.018, headX: 0, headY: Math.sin(t * 0.5) * 0.06, left: 0.15, right: 0.15, leftZ: -0.12, rightZ: 0.12 };
  }

  playThinkingAnimation(t) {
    return { ...this.playIdleAnimation(t), headY: Math.sin(t * 1.1) * 0.25, headX: -0.08 + Math.sin(t) * 0.04, right: -2.1, rightZ: -0.42 };
  }

  playWorkingAnimation(t) {
    return { ...this.playIdleAnimation(t), tilt: -0.04 + Math.sin(t * 4) * 0.02, headX: 0.12, headY: Math.sin(t) * 0.04, left: -1.15 + Math.sin(t * 11) * 0.12, right: -1.15 + Math.sin(t * 11 + Math.PI) * 0.12, leftZ: -0.2, rightZ: 0.2 };
  }

  playCompletedAnimation(t) {
    const wave = Math.sin(this.stateTime * 13);
    return { ...this.playIdleAnimation(t), y: Math.abs(Math.sin(this.stateTime * 6)) * 0.1, headY: wave * 0.1, left: -2.7 + wave * 0.15, right: -2.7 - wave * 0.15, leftZ: -0.5, rightZ: 0.5 };
  }

  update(deltaTime) {
    if (this.trip) { this.trip.update(deltaTime); return; }
    this.elapsed += deltaTime;
    this.stateTime += deltaTime;
    const t = this.elapsed + this.phase;
    const animations = { idle: 'playIdleAnimation', thinking: 'playThinkingAnimation', working: 'playWorkingAnimation', completed: 'playCompletedAnimation' };
    const target = this[animations[this.state]](t);
    const blend = 1 - Math.exp(-deltaTime * 9);
    for (const key of Object.keys(this.pose)) this.pose[key] = THREE.MathUtils.lerp(this.pose[key], target[key], blend);
    this.rig.position.y = this.pose.y;
    this.rig.rotation.x = this.pose.tilt;
    this.head.rotation.set(this.pose.headX, this.pose.headY, 0);
    this.arms[0].rotation.set(this.pose.left, 0, this.pose.leftZ);
    this.arms[1].rotation.set(this.pose.right, 0, this.pose.rightZ);
    const blinkTime = (this.elapsed + this.phase) % 4.6;
    const eyeOpen = blinkTime < 0.17 ? Math.max(0.06, Math.abs(blinkTime - 0.085) / 0.085) : 1;
    this.eyes.forEach(eye => { eye.scale.y = eyeOpen; });
    this.ringMaterial.opacity = THREE.MathUtils.lerp(this.ringMaterial.opacity, this.selected ? 0.65 : this.highlighted ? 0.32 : 0, blend);
    this.accent.emissiveIntensity = THREE.MathUtils.lerp(this.accent.emissiveIntensity, this.highlighted || this.selected ? 0.4 : 0.04, blend);
    if (this.state === 'completed' && this.stateTime >= 1.85) this.onCelebrationEnd(this.id);
  }
}
