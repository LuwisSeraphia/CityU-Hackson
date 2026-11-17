import { walkingRoute } from './WalkingRoute.js';

/** Walk around the desk into the right aisle, pick a book, return home. */
export class BookTrip {
  constructor(agent, destination, onDone, options = {}) {
    this.kind = options.kind || 'book';
    this.speed = options.speed || 2.1;
    this.pickupYaw = options.pickupYaw ?? Math.PI / 2;
    this.agent = agent;
    this.home = (agent.homePosition || agent.group.position).clone();
    this.outbound = options.waypoints || walkingRoute(this.home, destination);
    this.points = this.outbound;
    this.index = 0; this.phase = 'outbound'; this.time = 0; this.elapsed = 0;
    this.onDone = onDone; this.done = false;
  }
  update(delta) {
    if (this.done) return;
    this.elapsed += delta;
    const a = this.agent;
    if (this.phase === 'pickup') {
      this.time += delta;
      a.group.rotation.y = this.pickupYaw;
      if (this.kind === 'book' && this.time > 0.7) a.book.visible = true;
      if (this.time >= 1.4) {
        this.phase = 'return'; this.index = 0;
        this.points = [...this.outbound.slice(0, -1)].reverse().concat([this.home]);
      }
    } else {
      let budget = delta * this.speed;
      while (budget > 0 && this.index < this.points.length) {
        const target = this.points[this.index];
        const dx = target.x - a.group.position.x, dz = target.z - a.group.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.001) a.group.rotation.y = Math.atan2(dx, dz);
        if (distance <= budget) { a.group.position.copy(target); budget -= distance; this.index++; }
        else { a.group.position.x += dx / distance * budget; a.group.position.z += dz / distance * budget; budget = 0; }
      }
      if (this.index >= this.points.length) {
        if (this.phase === 'outbound') { this.phase = 'pickup'; this.time = 0; }
        else { this.finish(true); return; }
      }
    }
    const walking = this.phase !== 'pickup';
    const step = Math.sin(this.elapsed * 10);
    a.rig.position.y = -0.21 + (walking ? Math.abs(step) * 0.035 : 0);
    a.rig.rotation.x = 0;
    a.head.rotation.set(0, 0, 0);
    a.legs[0].rotation.x = walking ? step * 0.45 : 0;
    a.legs[1].rotation.x = walking ? -step * 0.45 : 0;
    a.arms[0].rotation.x = walking ? -step * 0.35 : this.kind === 'book' ? -1.7 : 0.15;
    a.arms[1].rotation.x = a.book.visible ? -1.1 : walking ? step * 0.35 : this.kind === 'book' ? -1.5 : 0.15;
  }
  finish(success = false) {
    if (this.done) return;
    this.done = true;
    const a = this.agent;
    a.group.position.copy(this.home); a.group.rotation.y = Math.PI;
    a.rig.position.y = 0; a.legs.forEach(leg => { leg.rotation.x = 0; });
    a.head.rotation.y = 0; a.book.visible = false;
    a.trip = null;
    if (success) this.onDone?.();
  }
}
