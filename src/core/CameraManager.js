import * as THREE from 'three';

export class CameraManager {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 80);
    this.camera.position.set(10, 13, 17);
    this.camera.lookAt(0, 0.6, 0);
    // Start at the 2.5D viewpoint; resizing preserves the OrbitControls orientation.
  }

  resize(width, height) {
    const aspect = width / Math.max(height, 1);
    const halfHeight = Math.max(6.6, 7.4 / aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }
}
