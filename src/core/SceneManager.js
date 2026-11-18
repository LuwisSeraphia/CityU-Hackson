import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CameraManager } from './CameraManager.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f7faff');
    this.cameraManager = new CameraManager();
    this.camera = this.cameraManager.camera;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.17;
    this.renderer.domElement.setAttribute('aria-label', '刘看山的知识星球 交互式三维办公室，可点击三个 Agent 查看详情');
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 2.5;
    this.controls.update();
    this.controls.saveState();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d8d5ce', 2.4));
    const sun = new THREE.DirectionalLight('#fff8ec', 3.4);
    sun.position.set(-5, 11, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 35 });
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.00015;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#e9f3ff', 1.1);
    fill.position.set(5, 5, -6);
    this.scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#f7faff', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.onContextLost = event => {
      event.preventDefault();
      container.dispatchEvent(new CustomEvent('render-unavailable', { detail: '图形上下文已中断，请刷新页面恢复办公室。' }));
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height);
    this.cameraManager.resize(width, height);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(surface => surface.dispose());
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
