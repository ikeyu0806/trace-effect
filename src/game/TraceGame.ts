import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GAME_CONFIG } from './config';
import { advanceFlight, createGameState, registerCollision, registerCut } from './state';

interface Trace { group: THREE.Group; x: number; y: number }
interface Projectile { mesh: THREE.Mesh; x: number; y: number }
interface ParticleBurst { points: THREE.Points; velocities: Float32Array; age: number }

interface UiElements {
  loading: HTMLElement;
  intro: HTMLElement;
  startButton: HTMLButtonElement;
  hud: HTMLElement;
  lives: HTMLElement;
  progress: HTMLElement;
  pause: HTMLElement;
  end: HTMLElement;
  endTitle: HTMLElement;
  restartButton: HTMLButtonElement;
  status: HTMLElement;
}

export class TraceGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 320);
  private readonly clock = new THREE.Clock();
  private readonly shipRoot = new THREE.Group();
  private readonly reticle = new THREE.Group();
  private readonly stars: THREE.Points[] = [];
  private readonly starMaterials: THREE.PointsMaterial[] = [];
  private readonly traces: Trace[] = [];
  private readonly afterimages: THREE.Object3D[] = [];
  private readonly particleBursts: ParticleBurst[] = [];
  private readonly targetStar = new THREE.Group();
  private state = createGameState();
  private projectile: Projectile | null = null;
  private spawnTimer = 0.35;
  private hitStop = 0;
  private approachTime = 0;
  private pointerX = 0;
  private pointerY = 0;
  private targetX = 0;
  private targetY = -1.65;
  private leftPressed = false;
  private rightPressed = false;
  private upPressed = false;
  private downPressed = false;

  constructor(canvas: HTMLCanvasElement, private readonly ui: UiElements) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE.Color(0x02050d);
    this.scene.fog = new THREE.FogExp2(0x030713, 0.009);
    this.camera.position.set(0, 5.6, 12.5);
    this.camera.lookAt(0, -0.25, -13);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.6, 0.68));
    this.composer.addPass(new OutputPass());

    this.buildWorld();
    this.bindEvents();
    this.resize();
    void this.loadShip();
    this.animate();
  }

  private buildWorld(): void {
    this.scene.add(new THREE.HemisphereLight(0xb9dcff, 0x080812, 1.7));
    const rimLight = new THREE.DirectionalLight(0x6adfff, 4.8);
    rimLight.position.set(-7, 8, 4);
    this.scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight(0xa06cff, 2.2);
    fillLight.position.set(7, 2, -4);
    this.scene.add(fillLight);

    this.shipRoot.position.set(0, -1.65, 0);
    this.shipRoot.rotation.set(0.04, Math.PI, 0);
    this.shipRoot.scale.setScalar(0.82);
    this.scene.add(this.shipRoot);
    this.createStarfields();
    this.createTargetStar();
    this.createReticle();
  }

  private createStarfields(): void {
    for (let layer = 0; layer < 5; layer += 1) {
      const count = layer === 0 ? 700 : 380;
      const positions = new Float32Array(count * 3);
      const random = this.seededRandom(29 + layer * 17);
      for (let index = 0; index < count; index += 1) {
        positions[index * 3] = (random() - 0.5) * 115;
        positions[index * 3 + 1] = (random() - 0.45) * 70;
        positions[index * 3 + 2] = -random() * 240 + 18;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: new THREE.Color().setHSL(0.54 + layer * 0.035, 0.72, 0.7),
        size: layer === 0 ? 0.16 : 0.22,
        transparent: true,
        opacity: layer === 0 ? 0.62 : 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.visible = layer === 0;
      this.stars.push(points);
      this.starMaterials.push(material);
      this.scene.add(points);
    }
  }

  private createTargetStar(): void {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 24), new THREE.MeshBasicMaterial({ color: 0xe8fbff }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 24), new THREE.MeshBasicMaterial({ color: 0x67ccff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.targetStar.add(core, halo);
    this.targetStar.position.set(0, 4.5, -120);
    this.scene.add(this.targetStar);
  }

  private createReticle(): void {
    const material = new THREE.LineBasicMaterial({ color: 0xaaf6ff, transparent: true, opacity: 0.82 });
    const points = [new THREE.Vector3(-.65,0,0),new THREE.Vector3(-.25,0,0),new THREE.Vector3(.25,0,0),new THREE.Vector3(.65,0,0),new THREE.Vector3(0,-.65,0),new THREE.Vector3(0,-.25,0),new THREE.Vector3(0,.25,0),new THREE.Vector3(0,.65,0)];
    this.reticle.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material));
    this.reticle.position.set(0, 0.6, -18);
    this.scene.add(this.reticle);
  }

  private async loadShip(): Promise<void> {
    try {
      const { scene: model } = await new GLTFLoader().loadAsync('/models/trace_fighter.glb');
      model.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
      this.shipRoot.add(model);
      this.ui.loading.hidden = true;
      this.ui.intro.hidden = false;
      this.ui.startButton.focus();
    } catch {
      this.ui.loading.innerHTML = '<div><p class="eyebrow">TRACE EFFECT</p><p>機体を読み込めませんでした</p></div>';
    }
  }

  private bindEvents(): void {
    this.ui.startButton.addEventListener('click', (event) => { event.stopPropagation(); this.start(); });
    this.ui.restartButton.addEventListener('click', (event) => { event.stopPropagation(); this.reset(); this.start(); });
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.state.phase !== 'playing') return;
    this.pointerX = THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
    this.pointerY = THREE.MathUtils.clamp(1 - (event.clientY / window.innerHeight) * 2, -1, 1);
    this.targetX = this.pointerX * GAME_CONFIG.fieldWidth * 0.5;
    this.targetY = THREE.MathUtils.lerp(GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY, (this.pointerY + 1) * .5);
  };

  private readonly onPointerDown = (): void => {
    if (this.state.phase === 'ready') this.start();
    else if (this.state.phase === 'playing') this.fire();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && (this.state.phase === 'playing' || this.state.phase === 'paused')) this.togglePause();
    if (this.state.phase !== 'playing') return;
    if (event.code === 'ArrowLeft') { event.preventDefault(); this.leftPressed = true; }
    if (event.code === 'ArrowRight') { event.preventDefault(); this.rightPressed = true; }
    if (event.code === 'ArrowUp') { event.preventDefault(); this.upPressed = true; }
    if (event.code === 'ArrowDown') { event.preventDefault(); this.downPressed = true; }
    if (event.code === 'Space') { event.preventDefault(); this.fire(); }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'ArrowLeft') this.leftPressed = false;
    if (event.code === 'ArrowRight') this.rightPressed = false;
    if (event.code === 'ArrowUp') this.upPressed = false;
    if (event.code === 'ArrowDown') this.downPressed = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden || this.state.phase !== 'playing') return;
    this.leftPressed = false;
    this.rightPressed = false;
    this.upPressed = false;
    this.downPressed = false;
    this.togglePause();
  };

  private readonly resize = (): void => {
    const width = window.innerWidth, height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  };

  private start(): void {
    if (this.state.phase !== 'ready') return;
    this.state = { ...this.state, phase: 'playing' };
    this.ui.intro.hidden = true;
    this.ui.hud.hidden = false;
    this.ui.status.textContent = '飛行開始';
    this.clock.getDelta();
    this.updateUi();
  }

  private reset(): void {
    this.state = createGameState(); this.spawnTimer = .35; this.hitStop = 0; this.approachTime = 0;
    this.pointerX = 0; this.pointerY = 0; this.targetX = 0; this.targetY = -1.65;
    this.leftPressed = false; this.rightPressed = false; this.upPressed = false; this.downPressed = false;
    this.shipRoot.position.set(0, -1.65, 0); this.shipRoot.rotation.set(.04, Math.PI, 0);
    this.reticle.position.set(0, .6, -18);
    this.clearObjects();
    this.targetStar.position.set(0, 4.5, -120); this.targetStar.scale.setScalar(1);
    this.ui.end.hidden = true; this.ui.pause.hidden = true; this.ui.status.textContent = '';
    this.setDepthVisuals(0); this.updateUi();
  }

  private togglePause(): void {
    const paused = this.state.phase === 'playing';
    this.state = { ...this.state, phase: paused ? 'paused' : 'playing' };
    this.ui.pause.hidden = !paused;
    this.ui.status.textContent = paused ? '一時停止' : '飛行再開';
    this.clock.getDelta();
  }

  private fire(): void {
    if (this.projectile) return;
    const geometry = new THREE.CapsuleGeometry(.09, 1.15, 4, 8); geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xc9fbff }));
    mesh.position.set(this.shipRoot.position.x, this.shipRoot.position.y + 1.03, -3.1); this.scene.add(mesh);
    this.projectile = { mesh, x: mesh.position.x, y: mesh.position.y };
  }

  private spawnTrace(): void {
    const x = THREE.MathUtils.randFloat(-GAME_CONFIG.fieldWidth * .48, GAME_CONFIG.fieldWidth * .48);
    const y = THREE.MathUtils.randFloat(GAME_CONFIG.fieldMinY + .4, GAME_CONFIG.fieldMaxY + 1.4);
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.CapsuleGeometry(.28, .72, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x263442, metalness: .82, roughness: .24, emissive: 0xff5b24, emissiveIntensity: 1.8 }),
    );
    shell.geometry.rotateX(Math.PI / 2);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(.3, .72, 12),
      new THREE.MeshBasicMaterial({ color: 0xffc56b }),
    );
    nose.geometry.rotateX(Math.PI / 2);
    nose.position.z = .83;
    const trail = new THREE.Mesh(
      new THREE.ConeGeometry(.34, 2.5, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff592e, transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    trail.geometry.rotateX(-Math.PI / 2);
    trail.position.z = -1.55;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(.58, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff7138, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(shell, nose, trail, halo);
    group.position.set(x, y, -72);
    this.scene.add(group); this.traces.push({ group, x, y });
  }

  private updatePlaying(delta: number): void {
    this.state = advanceFlight(this.state, delta);
    if (this.state.phase === 'approach') { this.beginApproach(); return; }
    const keyboardAxis = Number(this.rightPressed) - Number(this.leftPressed);
    if (keyboardAxis !== 0) {
      const limit = GAME_CONFIG.fieldWidth * .5;
      this.targetX = THREE.MathUtils.clamp(this.targetX + keyboardAxis * GAME_CONFIG.keyboardMoveSpeed * delta, -limit, limit);
      this.pointerX = this.targetX / limit;
    }
    const keyboardAxisY = Number(this.upPressed) - Number(this.downPressed);
    if (keyboardAxisY !== 0) {
      this.targetY = THREE.MathUtils.clamp(this.targetY + keyboardAxisY * GAME_CONFIG.keyboardMoveSpeedY * delta, GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY);
      this.pointerY = THREE.MathUtils.mapLinear(this.targetY, GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY, -1, 1);
    }
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0 && this.traces.length < GAME_CONFIG.maxTraces) { this.spawnTrace(); this.spawnTimer = GAME_CONFIG.spawnInterval; }
    this.shipRoot.position.x = THREE.MathUtils.damp(this.shipRoot.position.x, this.targetX, 22, delta);
    this.shipRoot.position.y = THREE.MathUtils.damp(this.shipRoot.position.y, this.targetY + Math.sin(this.clock.elapsedTime * 1.7) * .07, 22, delta);
    this.shipRoot.rotation.x = THREE.MathUtils.damp(this.shipRoot.rotation.x, .04 + this.pointerY * .08, 10, delta);
    this.shipRoot.rotation.z = THREE.MathUtils.damp(this.shipRoot.rotation.z, -this.pointerX * .15, 10, delta);
    this.reticle.position.x = THREE.MathUtils.damp(this.reticle.position.x, this.targetX * 1.35, 22, delta);
    this.reticle.position.y = THREE.MathUtils.damp(this.reticle.position.y, this.targetY + 2.25, 22, delta);
    this.updateProjectile(delta); this.updateTraces(delta); this.updateTravel(delta); this.updateUi();
  }

  private updateProjectile(delta: number): void {
    if (!this.projectile) return;
    this.projectile.mesh.position.z -= GAME_CONFIG.projectileSpeed * delta;
    const hitIndex = this.traces.findIndex((trace) =>
      Math.hypot(trace.x - this.projectile!.x, trace.y - this.projectile!.y) < .9 &&
      Math.abs(trace.group.position.z - this.projectile!.mesh.position.z) < 2.4,
    );
    if (hitIndex >= 0) { this.cutTrace(hitIndex); this.removeProjectile(); }
    else if (this.projectile.mesh.position.z < -92) this.removeProjectile();
  }

  private updateTraces(delta: number): void {
    for (let index = this.traces.length - 1; index >= 0; index -= 1) {
      const trace = this.traces[index]; trace.group.position.z += GAME_CONFIG.traceSpeed * delta;
      trace.group.rotation.z += delta * .9;
      if (trace.group.position.z > -.3) {
        if (Math.hypot(trace.x - this.shipRoot.position.x, trace.y - this.shipRoot.position.y) < 1.55) this.collideTrace(index);
        else if (trace.group.position.z > 7) this.removeTrace(index);
      }
    }
  }

  private cutTrace(index: number): void {
    const trace = this.traces[index]; this.createAfterimage(trace.x, trace.group.position.y, trace.group.position.z); this.removeTrace(index);
    this.state = registerCut(this.state); this.hitStop = GAME_CONFIG.hitStopDuration; this.setDepthVisuals(this.state.depth);
    this.ui.status.textContent = '光弾を撃ち落とした。粒子が増える'; this.updateUi();
  }

  private collideTrace(index: number): void {
    this.removeTrace(index); this.state = registerCollision(this.state); this.setDepthVisuals(this.state.depth); this.flashImpact();
    this.ui.status.textContent = '被弾。星空が一段薄くなる'; this.updateUi();
    if (this.state.phase === 'gameover') this.finish(false);
  }

  private createAfterimage(x: number, y: number, z: number): void {
    const count = 90;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = Math.pow(Math.random(), .62) * 4.2;
      const angle = Math.random() * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle) * radius * .7;
      positions[index * 3 + 2] = THREE.MathUtils.randFloatSpread(4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: new THREE.Color().setHSL(.52 + this.state.depth * .045, .92, .72),
      size: .2,
      transparent: true,
      opacity: .72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.position.set(x, y, Math.min(z, -24));
    this.scene.add(cloud); this.afterimages.push(cloud);
    this.createParticleBurst(x, y, z);
    if (this.afterimages.length > 28) { const oldest = this.afterimages.shift(); if (oldest) this.disposeObject(oldest); }
  }

  private createParticleBurst(x: number, y: number, z: number): void {
    const count = 52;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = new THREE.Vector3().randomDirection();
      const speed = THREE.MathUtils.randFloat(2.4, 8.5);
      velocities[index * 3] = direction.x * speed;
      velocities[index * 3 + 1] = direction.y * speed;
      velocities[index * 3 + 2] = direction.z * speed;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xb7f5ff, size: .28, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.position.set(x, y, z);
    this.scene.add(points);
    this.particleBursts.push({ points, velocities, age: 0 });
  }

  private updateParticleBursts(delta: number): void {
    for (let burstIndex = this.particleBursts.length - 1; burstIndex >= 0; burstIndex -= 1) {
      const burst = this.particleBursts[burstIndex];
      burst.age += delta;
      const attribute = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const positions = attribute.array as Float32Array;
      for (let index = 0; index < positions.length; index += 1) positions[index] += burst.velocities[index] * delta;
      attribute.needsUpdate = true;
      (burst.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - burst.age / 1.15);
      if (burst.age >= 1.15) {
        this.particleBursts.splice(burstIndex, 1);
        this.disposeObject(burst.points);
      }
    }
  }

  private flashImpact(): void {
    document.body.classList.remove('is-hit'); requestAnimationFrame(() => document.body.classList.add('is-hit'));
    window.setTimeout(() => document.body.classList.remove('is-hit'), 180);
  }

  private updateTravel(delta: number): void {
    const progress = this.state.elapsed / GAME_CONFIG.flightDuration;
    this.targetStar.position.z = THREE.MathUtils.lerp(-120, -64, progress); this.targetStar.scale.setScalar(THREE.MathUtils.lerp(1, 2.3, progress));
    for (let layer = 0; layer < this.stars.length; layer += 1) { const points = this.stars[layer]; points.position.z += delta * (2.6 + layer * .35); if (points.position.z > 12) points.position.z = -28; }
  }

  private setDepthVisuals(depth: number): void {
    for (let layer = 0; layer < this.stars.length; layer += 1) { const active = layer <= depth; this.stars[layer].visible = active; this.starMaterials[layer].opacity = layer === 0 ? .62 : active ? .48 + depth * .08 : 0; }
    this.renderer.toneMappingExposure = 1.08;
  }

  private beginApproach(): void { this.clearHazards(); this.ui.status.textContent = '最接近'; this.ui.hud.classList.add('is-approaching'); }
  private updateApproach(delta: number): void {
    this.approachTime += delta; const t = Math.min(1, this.approachTime / 3.6), eased = 1 - Math.pow(1 - t, 3);
    this.targetStar.position.z = THREE.MathUtils.lerp(-64, -9, eased);
    this.targetStar.scale.setScalar(THREE.MathUtils.lerp(2.3, 3.2 + this.state.depth * 3.4, eased));
    this.renderer.toneMappingExposure = 1.15 + eased * (.35 + this.state.depth * .12);
    if (t >= 1) this.finish(true);
  }

  private finish(completed: boolean): void {
    if (completed) this.state = { ...this.state, phase: 'complete' };
    this.ui.hud.hidden = true; this.ui.hud.classList.remove('is-approaching'); this.ui.end.hidden = false;
    this.ui.end.dataset.result = completed ? 'complete' : 'gameover';
    this.ui.endTitle.textContent = completed ? 'GAME CLEAR' : 'GAME OVER';
    this.ui.restartButton.focus();
  }

  private updateUi(): void {
    this.ui.lives.innerHTML = Array.from({ length: GAME_CONFIG.maxLives }, (_, index) => `<span class="life${index >= this.state.lives ? ' is-lost' : ''}" aria-hidden="true"></span>`).join('');
    this.ui.lives.setAttribute('aria-label', `残機 ${this.state.lives}`);
    this.ui.progress.style.setProperty('--flight-progress', `${this.state.elapsed / GAME_CONFIG.flightDuration}`);
  }

  private animate = (): void => {
    const delta = Math.min(this.clock.getDelta(), .05), elapsed = this.clock.elapsedTime;
    this.reticle.rotation.z = elapsed * .18; this.targetStar.rotation.y = elapsed * .1;
    if (this.hitStop > 0) this.hitStop -= delta;
    else if (this.state.phase === 'playing') this.updatePlaying(delta);
    else if (this.state.phase === 'approach') this.updateApproach(delta);
    this.updateParticleBursts(delta);
    this.composer.render(); requestAnimationFrame(this.animate);
  };

  private removeProjectile(): void { if (this.projectile) { this.disposeObject(this.projectile.mesh); this.projectile = null; } }
  private removeTrace(index: number): void { const [trace] = this.traces.splice(index, 1); if (trace) this.disposeObject(trace.group); }
  private clearHazards(): void { while (this.traces.length) this.removeTrace(this.traces.length - 1); this.removeProjectile(); }
  private clearObjects(): void {
    this.clearHazards();
    while (this.afterimages.length) { const image = this.afterimages.pop(); if (image) this.disposeObject(image); }
    while (this.particleBursts.length) { const burst = this.particleBursts.pop(); if (burst) this.disposeObject(burst.points); }
  }
  private disposeObject(object: THREE.Object3D): void {
    object.removeFromParent();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.LineSegments)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
    });
  }
  private seededRandom(seed: number): () => number { let value = seed; return () => { value = value * 16807 % 2147483647; return (value - 1) / 2147483646; }; }
}

export type { UiElements };
