import * as THREE from 'three';
import { BookTrip } from './BookTrip.js';

/** Only one idle colleague uses the aisle at a time; tasks always take priority. */
export class IdleWalkController {
  constructor(agents, random = Math.random) {
    this.agents = agents;
    this.random = random;
    this.wait = 6 + random() * 5;
    this.lastId = null;
  }
  update(delta) {
    if (delta <= 0) return;
    if ([...this.agents.values()].some(agent => agent.trip)) return;
    this.wait -= delta;
    if (this.wait > 0) return;
    const available = [...this.agents.values()].filter(agent => agent.state === 'idle' && !agent.selected);
    const different = available.filter(agent => agent.id !== this.lastId);
    const candidates = different.length ? different : available;
    if (!candidates.length) { this.wait = 2; return; }
    const agent = candidates[Math.floor(this.random() * candidates.length)];
    this.lastId = agent.id;
    this.wait = 12 + this.random() * 12;
    const destination = new THREE.Vector3(4, 0, 3.8 + this.random() * 0.8);
    agent.trip = new BookTrip(agent, destination, null, {
      kind: 'wander', speed: 1.25,
    });
  }
}
