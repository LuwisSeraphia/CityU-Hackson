import { Office } from './Office.js';

/** Replace the current procedural office from a validated scene description. */
export class SceneBuilder {
  constructor(scene, onCelebrationEnd) {
    this.scene = scene;
    this.onCelebrationEnd = onCelebrationEnd;
    this.office = null;
  }

  build(description) {
    if (!description || !Array.isArray(description.agents) || description.agents.length !== 3) {
      throw new TypeError('场景需要包含三个 Agent。');
    }
    const ids = new Set();
    for (const agent of description.agents) {
      if (!['browser', 'computer', 'file'].includes(agent.id) || ids.has(agent.id)) {
        throw new TypeError('Agent id 无效或重复。');
      }
      ids.add(agent.id);
      if (!Array.isArray(agent.position) || agent.position.length !== 3 || !agent.position.every(Number.isFinite)) {
        throw new TypeError(`Agent ${agent.id} 的 position 必须是三个数字。`);
      }
      if (agent.position.some(value => Math.abs(value) > 4)) throw new RangeError('工位坐标须在 -4 到 4 之间。');
    }
    const next = new Office(this.scene, description.agents, this.onCelebrationEnd);
    next.group.position.set(...(description.offset || [0, 0, 0]));
    next.group.rotation.y = Number.isFinite(description.rotationY) ? description.rotationY : 0;
    next.group.scale.setScalar(Number.isFinite(description.scale) ? Math.min(1.3, Math.max(0.8, description.scale)) : 1);
    this.office?.dispose();
    this.office = next;
    return next;
  }

  update(delta) { this.office?.update(delta); }
  dispose() { this.office?.dispose(); this.office = null; }
}
