import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore } from '../src/state/AgentStore.js';

let THREE;
try { THREE = await import('three'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('Three.js models, animation, picking and camera', { skip: !THREE && 'Three.js is not installed; run npm install to enable 3D checks' }, async t => {
  const { Agent } = await import('../src/world/Agent.js');
  const { Desk } = await import('../src/world/Desk.js');
  const { CameraManager } = await import('../src/core/CameraManager.js');
  const { RaycastManager } = await import('../src/interaction/RaycastManager.js');
  const definitions = new AgentStore().getSnapshot().agents;

  await t.test('every descendant belongs to a hierarchical Agent group', () => {
    const agent = new Agent(definitions[0]);
    assert.ok(agent.group instanceof THREE.Group);
    assert.equal(agent.group.userData.agentId, 'browser');
    assert.ok(agent.head.parent === agent.rig);
    assert.ok(agent.arms.every(arm => arm.parent === agent.rig));
    assert.equal(agent.eyes.length, 2);
    const desk = new Desk(definitions[0].color);
    assert.ok(new THREE.Box3().setFromObject(desk).max.y > 2);
  });

  await t.test('poses blend smoothly, independent animations progress using delta time', () => {
    const a = new Agent(definitions[0]);
    const b = new Agent(definitions[0]);
    a.setState('working');
    b.setState('working');
    a.update(1 / 60);
    assert.ok(a.arms[0].rotation.x < 0.15 && a.arms[0].rotation.x > -0.6);
    for (let i = 1; i < 120; i++) a.update(1 / 60);
    for (let i = 0; i < 60; i++) b.update(1 / 30);
    assert.ok(Math.abs(a.arms[0].rotation.x - b.arms[0].rotation.x) < 0.04);
    assert.equal(a.state, 'working');
    const other = new Agent(definitions[1]);
    other.update(0.1);
    assert.equal(other.state, 'idle');
    assert.notEqual(other.rig.position.y, a.rig.position.y);
  });

  await t.test('celebration returns to idle without recounting completion', () => {
    const store = new AgentStore();
    const agent = new Agent(definitions[0], id => store.finishCelebration(id));
    store.subscribe(snapshot => agent.setState(snapshot.agents[0].state));
    store.transition('browser', 'working');
    store.transition('browser', 'completed');
    for (let i = 0; i < 150; i++) agent.update(1 / 60);
    assert.equal(agent.state, 'idle');
    assert.equal(store.getSnapshot().stats.completed, 1);
  });

  await t.test('orthographic bounds match viewport aspect while view direction stays fixed', () => {
    const manager = new CameraManager();
    const direction = new THREE.Vector3();
    manager.camera.getWorldDirection(direction);
    for (const [width, height] of [[900, 650], [450, 700], [1600, 700], [300, 450]]) {
      manager.resize(width, height);
      const camera = manager.camera;
      assert.ok(Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - width / height) < 1e-8);
      const after = new THREE.Vector3();
      camera.getWorldDirection(after);
      assert.ok(after.distanceTo(direction) < 1e-8);
    }
  });

  await t.test('raycasting uses canvas offset and resolves clicks on head child meshes', () => {
    const store = new AgentStore();
    const agent = new Agent(definitions[0]);
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 30);
    camera.position.set(agent.group.position.x, 1.78, agent.group.position.z + 10);
    camera.lookAt(agent.group.position.x, 1.78, agent.group.position.z);
    camera.updateMatrixWorld();
    const handlers = {};
    const canvas = { style: {}, getBoundingClientRect: () => ({ left: 250, top: 100, width: 800, height: 600 }), addEventListener: (type, callback) => { handlers[type] = callback; }, removeEventListener: type => delete handlers[type] };
    const raycast = new RaycastManager(canvas, camera, new Map([['browser', agent]]), store);
    handlers.pointermove({ clientX: 650, clientY: 400 });
    raycast.update();
    assert.equal(raycast.hoveredId, 'browser');
    assert.equal(canvas.style.cursor, 'pointer');
    handlers.click({ clientX: 650, clientY: 400 });
    assert.equal(store.selectedId, 'browser');
    handlers.click({ clientX: 251, clientY: 101 });
    assert.equal(store.selectedId, null);
    handlers.pointerdown({ clientX: 610, clientY: 400 });
    handlers.pointermove({ clientX: 650, clientY: 400 });
    handlers.click({ clientX: 650, clientY: 400 });
    assert.equal(store.selectedId, null, 'dragging across a character must not select it');
    handlers.pointerdown({ clientX: 650, clientY: 400 });
    handlers.click({ clientX: 650, clientY: 400 });
    assert.equal(store.selectedId, 'browser', 'normal clicks still select after a drag');
    raycast.dispose();
    assert.equal(Object.keys(handlers).length, 0);
  });
  await t.test('heads face the monitor after idle and work updates', () => {
    const agent = new Agent(definitions[0]);
    for (const state of ['idle', 'thinking', 'working']) {
      agent.setState(state);
      for (let frame = 0; frame < 120; frame++) agent.update(1 / 60);
      agent.group.updateMatrixWorld(true);
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(agent.head.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(direction.z < -0.85, `${state}: head must face the monitor along -Z`);
    }
  });

});
