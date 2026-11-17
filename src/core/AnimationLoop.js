import * as THREE from 'three';

export class AnimationLoop {
  constructor(update, render) {
    this.clock = new THREE.Clock(false);
    this.update = update;
    this.render = render;
    this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.speed = 1;
    this.running = false;
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.tick = () => {
      if (!this.running) return;
      // Clamp long frames after backgrounding; never create geometries in the loop.
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(this.paused ? 0 : delta * this.speed);
      this.render();
      this.frameId = requestAnimationFrame(this.tick);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.clock.stop();
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
