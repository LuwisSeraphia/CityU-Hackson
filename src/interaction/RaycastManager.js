import * as THREE from 'three';

export class RaycastManager {
  constructor(canvas, camera, agents, store) {
    this.canvas = canvas;
    this.camera = camera;
    this.agents = agents;
    this.store = store;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.roots = [...agents.values()].map(agent => agent.group);
    this.pointerInside = false;
    this.hoveredId = null;
    this.move = event => { this.setPointer(event); this.pointerInside = true; };
    this.leave = () => { this.pointerInside = false; this.setHovered(null); };
    this.down = event => {
      this.press = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      this.dragged = false;
    };
    const hover = this.move;
    this.move = event => {
      if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 5) this.dragged = true;
      hover(event);
    };
    this.click = event => {
      const moved = this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 5;
      if (this.dragged || moved) { this.press = null; return; }
      this.press = null;
      this.setPointer(event);
      this.store.select(this.hitTest());
    };
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('click', this.click);
  }

  setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  }

  hitTest() {
    this.camera.updateMatrixWorld();
    this.roots.forEach(root => root.updateWorldMatrix(true, true));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const hit of hits) {
      // Floor selection rings are visual feedback, not click targets.
      if (hit.object === this.agents.get(hit.object.parent?.userData.agentId)?.ring) continue;
      let node = hit.object;
      while (node) {
        if (node.userData.agentId) return node.userData.agentId;
        node = node.parent;
      }
    }
    return null;
  }

  setHovered(id) {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : 'default';
    this.agents.forEach(agent => { agent.highlighted = agent.id === id; });
  }

  setAgents(agents) {
    this.agents = agents;
    this.roots = [...agents.values()].map(agent => agent.group);
  }

  update() {
    if (this.pointerInside) this.setHovered(this.hitTest());
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerleave', this.leave);
    this.canvas.removeEventListener('click', this.click);
  }
}
