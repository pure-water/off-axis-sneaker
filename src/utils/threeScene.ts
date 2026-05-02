import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HeadPose } from './headPose';
import { OffAxisCamera } from './offAxisCamera';
import { calibrationManager, CalibrationData } from './calibration';

export interface ThreeSceneOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
}

export class ThreeSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private offAxisCamera: OffAxisCamera;
  private model: THREE.Object3D | null = null;
  private lightsInitialized = false;
  private animationFrameId: number | null = null;
  private isRunning = false;
  private currentHeadPose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private debugMode: boolean = false;
  private debugHelpers: THREE.Object3D[] = [];
  private roomObjects: THREE.Object3D[] = [];
  private currentModelName = 'shoe';
  private porcheLights: THREE.Light[] = [];

  constructor(options: ThreeSceneOptions) {
    const width = options.width || options.container.clientWidth;
    const height = options.height || options.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 5;

    const calibration = calibrationManager.getCalibration();
    calibration.pixelWidth = width;
    calibration.pixelHeight = height;
    calibrationManager.updatePixelDimensions(width, height);

    this.offAxisCamera = new OffAxisCamera(this.camera, calibration);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    options.container.appendChild(this.renderer.domElement);

    this.loadModel(this.currentModelName);
    this.createWireframeRoom();
    this.createDebugHelpers();
  }

  private async findBestModelPath(modelName: string): Promise<string | null> {
    const normalized = modelName.trim().toLowerCase();
    const candidates = [
      `/models/${normalized}.glb`,
      `/models/${normalized}/${normalized}.glb`,
      `/models/${normalized}/main.glb`,
      `/models/${normalized}/model.glb`,
      `/models/${normalized}/${normalized}-low.glb`,
      `/models/${normalized}/${normalized}_low.glb`
    ];

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { method: 'HEAD' });
        if (response.ok) {
          return candidate;
        }
      } catch (error) {
        console.warn('Model lookup failed:', candidate, error);
      }
    }

    return null;
  }


  private async isGitLfsPointer(modelPath: string): Promise<boolean> {
    try {
      const response = await fetch(modelPath);
      if (!response.ok) return false;
      const snippet = (await response.text()).slice(0, 200);
      return snippet.includes('git-lfs.github.com/spec/v1');
    } catch {
      return false;
    }
  }


  private getModelDefaults(modelName: string): { position: THREE.Vector3; rotation: THREE.Euler; scale: number } {
    const normalized = modelName.trim().toLowerCase();
    if (normalized === 'shoe') {
      return {
        position: new THREE.Vector3(0.006, -0.1, -0.139),
        rotation: new THREE.Euler(0, -0.628, 0),
        scale: 0.055
      };
    }

    return {
      position: new THREE.Vector3(0, -0.09, -0.03),
      rotation: new THREE.Euler(0, -0.628, 0),
      scale: 0.0551
    };
  }

  private updatePorcheLight(modelName: string): void {
    const normalized = modelName.trim().toLowerCase();
    const needsPorcheLight = normalized === 'porche';

    if (needsPorcheLight && this.porcheLights.length === 0) {
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
      keyLight.position.set(1.5, 2.2, 1.8);

      const fillLight = new THREE.DirectionalLight(0xffffff, 2.1);
      fillLight.position.set(-2.0, 1.0, 1.2);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x303030, 1.8);

      this.porcheLights = [keyLight, fillLight, hemiLight];
      this.porcheLights.forEach((light) => this.scene.add(light));
      return;
    }

    if (!needsPorcheLight && this.porcheLights.length > 0) {
      this.porcheLights.forEach((light) => this.scene.remove(light));
      this.porcheLights = [];
    }
  }

  private loadModel(modelName: string): void {
    if (!this.lightsInitialized) {
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(ambientLight);

      const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight1.position.set(1, 1, 1);
      this.scene.add(directionalLight1);

      const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight2.position.set(-1, -1, 0.5);
      this.scene.add(directionalLight2);
      this.lightsInitialized = true;
    }

    this.updatePorcheLight(modelName);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    this.findBestModelPath(modelName).then((modelPath) => {
      if (!modelPath) {
        console.error(`No .glb model found for "${modelName}" under /public/models.`);
        return;
      }

      this.isGitLfsPointer(modelPath).then((isPointer) => {
        if (isPointer) {
          console.error(`Model at ${modelPath} is a Git LFS pointer, not a real .glb binary. Run fetch_model.sh or pull LFS objects.`);
          return;
        }

        loader.load(
          modelPath,
          (gltf) => {
          this.model = gltf.scene;

          const box = new THREE.Box3().setFromObject(this.model);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);

          const defaults = this.getModelDefaults(modelName);
          this.model.position.set(0, 0, 0);
          this.model.rotation.copy(defaults.rotation);

          const maxDim = Math.max(size.x, size.y, size.z);
          const fitScale = maxDim > 0 ? 0.18 / maxDim : defaults.scale;
          this.model.scale.setScalar(Math.min(Math.max(fitScale, 0.01), 0.3));

          this.model.position.sub(center.multiplyScalar(this.model.scale.x));
          this.model.position.x += defaults.position.x;
          this.model.position.y += defaults.position.y;
          this.model.position.z += defaults.position.z;

          let meshCount = 0;
          this.model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              meshCount += 1;
              child.castShadow = false;
              child.receiveShadow = true;

              if (modelName.trim().toLowerCase() === 'porche') {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => {
                  if ('metalness' in material && typeof material.metalness === 'number') {
                    material.metalness = Math.max(0, material.metalness - 0.25);
                  }
                  if ('roughness' in material && typeof material.roughness === 'number') {
                    material.roughness = Math.max(0.12, material.roughness - 0.1);
                  }
                });
              }
            }
          });

          console.info('[ThreeScene] Loaded model', {
            modelName,
            modelPath,
            meshCount,
            bboxSize: { x: size.x, y: size.y, z: size.z },
            appliedScale: this.model.scale.x
          });

          this.scene.add(this.model);
        },
          undefined,
          (error) => {
            console.error('Error loading model:', error);
          }
        );
      });
    });
  }

  setModel(modelName: string): void {
    this.currentModelName = modelName;
    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }
    this.loadModel(modelName);
  }

  private createWireframeRoom(): void {
    this.removeWireframeRoom();

    const screenDims = this.offAxisCamera.getScreenDimensions();
    const roomWidth = screenDims.width;
    const roomHeight = screenDims.height;
    const roomDepth = 0.35;
    const gridDivisions = 8;
    const gridColor = 0xff8c00;

    const wallMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: true,
      linewidth: 8
    });

    const createGridWall = (width: number, height: number): THREE.LineSegments => {
      const geometry = new THREE.BufferGeometry();
      const vertices: number[] = [];

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2 + t * width, -height / 2, 0);
        vertices.push(-width / 2 + t * width, height / 2, 0);
      }

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2, -height / 2 + t * height, 0);
        vertices.push(width / 2, -height / 2 + t * height, 0);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return new THREE.LineSegments(geometry, wallMaterial);
    };

    const backWall = createGridWall(roomWidth, roomHeight);
    backWall.position.z = -roomDepth;
    this.scene.add(backWall);
    this.roomObjects.push(backWall);

    const leftWall = createGridWall(roomDepth, roomHeight);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -roomWidth / 2;
    leftWall.position.z = -roomDepth / 2;
    this.scene.add(leftWall);
    this.roomObjects.push(leftWall);

    const rightWall = createGridWall(roomDepth, roomHeight);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = roomWidth / 2;
    rightWall.position.z = -roomDepth / 2;
    this.scene.add(rightWall);
    this.roomObjects.push(rightWall);

    const floor = createGridWall(roomWidth, roomDepth);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = -roomHeight / 2;
    floor.position.z = -roomDepth / 2;
    this.scene.add(floor);
    this.roomObjects.push(floor);

    const ceiling = createGridWall(roomWidth, roomDepth);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = roomHeight / 2;
    ceiling.position.z = -roomDepth / 2;
    this.scene.add(ceiling);
    this.roomObjects.push(ceiling);

    const screenFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(roomWidth, roomHeight)),
      new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 4,
        depthTest: true,
        depthWrite: true
      })
    );
    screenFrame.position.z = 0.001;
    this.scene.add(screenFrame);
    this.roomObjects.push(screenFrame);
  }

  private removeWireframeRoom(): void {
    this.roomObjects.forEach(obj => {
      this.scene.remove(obj);
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });
    this.roomObjects = [];
  }

  private createDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.debugHelpers.push(axesHelper);
    this.scene.add(axesHelper);

    const headPositionMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff })
    );
    headPositionMarker.visible = false;
    this.debugHelpers.push(headPositionMarker);
    this.scene.add(headPositionMarker);
  }

  updateHeadPose(headPose: HeadPose): void {
    this.currentHeadPose = headPose;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.debugHelpers.forEach(helper => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    this.createWireframeRoom();
  }

  updateModelPosition(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.position.set(x, y, z);
    }
  }

  updateModelScale(scale: number): void {
    if (this.model) {
      this.model.scale.set(scale, scale, scale);
    }
  }

  getModelPosition(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.position.x,
        y: this.model.position.y,
        z: this.model.position.z
      };
    }
    const defaults = this.getModelDefaults(this.currentModelName).position;
    return { x: defaults.x, y: defaults.y, z: defaults.z };
  }

  getModelScale(): number {
    if (this.model) {
      return this.model.scale.x;
    }
    return this.getModelDefaults(this.currentModelName).scale;
  }

  updateModelRotation(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.rotation.set(x, y, z);
    }
  }

  getModelRotation(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.rotation.x,
        y: this.model.rotation.y,
        z: this.model.rotation.z
      };
    }
    return { x: 0, y: -0.628, z: 0 };
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    this.offAxisCamera.updateFromHeadPose(this.currentHeadPose);

    if (this.debugMode && this.debugHelpers.length > 1) {
      const worldPos = this.offAxisCamera.headPoseToWorldPosition(this.currentHeadPose);
      this.debugHelpers[1].position.set(worldPos.x, worldPos.y, worldPos.z);
    }

    this.renderer.render(this.scene, this.camera);
  };

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.animate();
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.stop();

    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
