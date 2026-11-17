import * as THREE from 'three';
import { Desk } from './Desk.js';
import { Agent } from './Agent.js';
import { LibraryWall } from './LibraryWall.js';
import { BookTrip } from './BookTrip.js';
import { IdleWalkController } from './IdleWalkController.js';
import { box, sphere, mesh, material, createContactTexture, contactShadow } from './primitives.js';

export class Office {
  constructor(scene, definitions, onCelebrationEnd) {
    this.group = new THREE.Group();
    this.group.name = '刘看山的知识星球 Office';
    scene.add(this.group);
    this.agents = new Map();
    this.desks = new Map();
    this.contactTexture = createContactTexture();
    const white = material('#f9f9f6');
    box(this.group, [11.4, 0.16, 12.4], [0, -0.105, 0.7], white, 0.12);
    definitions.forEach(definition => {
      const desk = new Desk(definition.color);
      desk.position.set(...definition.position);
      this.group.add(desk);
      this.desks.set(definition.id, desk);
      contactShadow(this.group, this.contactTexture, definition.position[0], definition.position[2] + 0.2, 3.5, 2.5);
      const agent = new Agent(definition, onCelebrationEnd);
      this.group.add(agent.group);
      this.agents.set(definition.id, agent);
    });
    this.walkController = new IdleWalkController(this.agents);
    this.createCoffeeCorner();
    this.library = new LibraryWall();
    this.group.add(this.library);
    this.createPlant(-4.5, 3.5, 0.72);
  }

  createCoffeeCorner() {
    const corner = new THREE.Group();
    corner.position.set(-3.9, 0, -3.45);
    this.group.add(corner);
    const white = material('#f4f4ef');
    const grey = material('#d8dcd9', { metalness: 0.25 });
    box(corner, [1.8, 1.12, 0.73], [0, 0.56, 0], white, 0.04);
    box(corner, [1.95, 0.065, 0.85], [0, 1.15, 0], material('#ffffff'), 0.025);
    for (const x of [-0.59, 0, 0.59]) box(corner, [0.009, 1, 0.012], [x, 0.53, 0.37], grey, 0.001);
    box(corner, [0.55, 0.55, 0.42], [0.48, 1.46, -0.03], grey, 0.04);
    box(corner, [0.39, 0.29, 0.03], [0.48, 1.42, 0.19], material('#464c4b'), 0.02);
    mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.15, 20), white, [0.48, 1.27, 0.13], corner);
    for (const x of [-0.65, -0.37]) {
      const cup = mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.14, 20), material('#d4b58d'), [x, 1.26, 0.08], corner);
      const handle = mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 16), cup.material, [x + 0.09, 1.27, 0.08], corner);
      handle.rotation.y = Math.PI / 2;
    }
    contactShadow(this.group, this.contactTexture, -3.9, -3.45, 2.5, 1.5);
  }

  createPlant(x, z, scale = 1) {
    const plant = new THREE.Group();
    plant.position.set(x, 0, z);
    plant.scale.setScalar(scale);
    this.group.add(plant);
    mesh(new THREE.CylinderGeometry(0.28, 0.21, 0.48, 24), material('#e1e0d8'), [0, 0.24, 0], plant);
    mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), material('#73705f'), [0, 0.48, 0], plant);
    const green = material('#8d9c7c');
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4;
      const leaf = sphere(plant, 0.2, [Math.cos(angle) * 0.17, 0.83 + i % 3 * 0.12, Math.sin(angle) * 0.17], green, [0.52, 2, 0.8]);
      leaf.rotation.z = Math.cos(angle) * 0.65;
      leaf.rotation.x = Math.sin(angle) * 0.65;
    }
    contactShadow(this.group, this.contactTexture, x, z, 1.4 * scale, 1.4 * scale);
  }

  sync(snapshot) {
    snapshot.agents.forEach(definition => {
      const agent = this.agents.get(definition.id);
      agent.setState(definition.state);
      agent.selected = snapshot.selectedId === definition.id;
      this.desks.get(definition.id).setState(definition.state);
    });
  }

  retrieve(id, onDone) {
    const agent = this.agents.get(id);
    if (agent?.trip?.kind === 'wander') agent.trip.finish(false);
    if (!agent || agent.trip) return false;
    agent.trip = new BookTrip(agent, this.library.destination, onDone, { pickupYaw: this.library.pickupYaw });
    return true;
  }

  update(deltaTime) {
    this.walkController.update(deltaTime);
    this.agents.forEach(agent => agent.update(deltaTime));
  }

  dispose() {
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(item => materials.add(item));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(surface => surface.dispose());
    this.contactTexture.dispose();
    this.group.removeFromParent();
  }
}
