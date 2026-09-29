import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GAME_CONFIG } from './config';
import { advanceFlight, createGameState, registerCollision, registerCut } from './state';

interface Trace { group: THREE.Group; x: number }
interface Projectile { mesh: THREE.Mesh; x: number }

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
  endCopy: HTMLElement;
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
  private readonly targetStar = new THREE.Group();
  private readonly nebula: THREE.Mesh;
  private state = createGameState();
  private projectile: Projectile | null = null;
  private spawnTimer = 0.35;
  private hitStop = 0;
  private approachTime = 0;
  private pointerX = 0;
  private targetX = 0;

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

    this.nebula = this.createNebula();
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
    this.scene.add(this.nebula);
    this.createTargetStar();
    this.createReticle();
  }

  private createStarfields(): void {
    for (let layer = 0; layer < 5; layer += 1) {
      const count = layer === 0 ? 700 : 260;
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

  private createNebula(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        varying vec2 vUv; uniform float uOpacity; uniform float uTime;
        float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
        void main(){vec2 p=vUv*4.;float c=noise(p+vec2(uTime*.008,0.))+noise(p*2.1-vec2(uTime*.005,0.))*.45;float v=smoothstep(.76,.18,distance(vUv,vec2(.5)));vec3 color=mix(vec3(.03,.18,.32),vec3(.24,.05,.35),vUv.x+c*.2);gl_FragColor=vec4(color,c*v*uOpacity*.62);}
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 82), material);
    mesh.position.set(0, 8, -92);
    return mesh;
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
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.state.phase !== 'playing') return;
    this.pointerX = THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
    this.targetX = this.pointerX * GAME_CONFIG.fieldWidth * 0.5;
  };

  private readonly onPointerDown = (): void => {
    if (this.state.phase === 'ready') this.start();
    else if (this.state.phase === 'playing') this.fire();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && (this.state.phase === 'playing' || this.state.phase === 'paused')) this.togglePause();
    if (event.code === 'Space' && this.state.phase === 'playing') { event.preventDefault(); this.fire(); }
  };
  private readonly onVisibilityChange = (): void => { if (document.hidden && this.state.phase === 'playing') this.togglePause(); };

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
    mesh.position.set(this.shipRoot.position.x, -.62, -3.1); this.scene.add(mesh);
    this.projectile = { mesh, x: mesh.position.x };
  }

  private spawnTrace(): void {
    const x = THREE.MathUtils.randFloat(-GAME_CONFIG.fieldWidth * .48, GAME_CONFIG.fieldWidth * .48);
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,5.6,8), new THREE.MeshBasicMaterial({ color: 0xdffcff })),
      new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,5.9,8), new THREE.MeshBasicMaterial({ color: 0x31cfff, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    group.position.set(x, .45, -72); group.rotation.z = THREE.MathUtils.randFloatSpread(.18);
    this.scene.add(group); this.traces.push({ group, x });
  }

  private updatePlaying(delta: number): void {
    this.state = advanceFlight(this.state, delta);
    if (this.state.phase === 'approach') { this.beginApproach(); return; }
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0 && this.traces.length < GAME_CONFIG.maxTraces) { this.spawnTrace(); this.spawnTimer = GAME_CONFIG.spawnInterval; }
    this.shipRoot.position.x = THREE.MathUtils.damp(this.shipRoot.position.x, this.targetX, 22, delta);
    this.shipRoot.rotation.z = THREE.MathUtils.damp(this.shipRoot.rotation.z, -this.pointerX * .15, 10, delta);
    this.reticle.position.x = THREE.MathUtils.damp(this.reticle.position.x, this.targetX * 1.35, 22, delta);
    this.updateProjectile(delta); this.updateTraces(delta); this.updateTravel(delta); this.updateUi();
  }

  private updateProjectile(delta: number): void {
    if (!this.projectile) return;
    this.projectile.mesh.position.z -= GAME_CONFIG.projectileSpeed * delta;
    const hitIndex = this.traces.findIndex((trace) => Math.abs(trace.x - this.projectile!.x) < .8 && Math.abs(trace.group.position.z - this.projectile!.mesh.position.z) < 2.4);
    if (hitIndex >= 0) { this.cutTrace(hitIndex); this.removeProjectile(); }
    else if (this.projectile.mesh.position.z < -92) this.removeProjectile();
  }

  private updateTraces(delta: number): void {
    for (let index = this.traces.length - 1; index >= 0; index -= 1) {
      const trace = this.traces[index]; trace.group.position.z += GAME_CONFIG.traceSpeed * delta;
      if (trace.group.position.z > -.3) {
        if (Math.abs(trace.x - this.shipRoot.position.x) < 1.65) this.collideTrace(index);
        else if (trace.group.position.z > 7) this.removeTrace(index);
      }
    }
  }

  private cutTrace(index: number): void {
    const trace = this.traces[index]; this.createAfterimage(trace.x, trace.group.position.y, trace.group.position.z); this.removeTrace(index);
    this.state = registerCut(this.state); this.hitStop = GAME_CONFIG.hitStopDuration; this.setDepthVisuals(this.state.depth);
    this.ui.status.textContent = '光を断った。星空が濃くなる'; this.updateUi();
  }

  private collideTrace(index: number): void {
    this.removeTrace(index); this.state = registerCollision(this.state); this.setDepthVisuals(this.state.depth); this.flashImpact();
    this.ui.status.textContent = '被弾。星空が一段薄くなる'; this.updateUi();
    if (this.state.phase === 'gameover') this.finish(false);
  }

  private createAfterimage(x: number, y: number, z: number): void {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(.52 + this.state.depth * .045, .95, .65), transparent: true, opacity: .52, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(.12, 5.7), material);
    line.position.set(x, y, Math.min(z, -28)); line.rotation.z = THREE.MathUtils.randFloatSpread(.2);
    this.scene.add(line); this.afterimages.push(line);
    if (this.afterimages.length > 28) { const oldest = this.afterimages.shift(); if (oldest) this.disposeObject(oldest); }
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
    for (let layer = 0; layer < this.stars.length; layer += 1) { const active = layer <= depth; this.stars[layer].visible = active; this.starMaterials[layer].opacity = layer === 0 ? .62 : active ? .35 + depth * .1 : 0; }
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uOpacity.value = depth / GAME_CONFIG.maxDepth;
    this.renderer.toneMappingExposure = 1.05 + depth * .07;
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
    this.ui.endTitle.textContent = completed ? '星に触れた' : '光が遠ざかる';
    this.ui.endCopy.textContent = completed ? this.getCompletionCopy() : '目的の星を前に、航路が途切れた。';
    this.ui.restartButton.focus();
  }

  private getCompletionCopy(): string {
    return ['静かな点のそばを通り過ぎた。','残した光が、星の輪郭を少し広げた。','重なった軌跡が、星を大きく照らした。','濃い星空が、最接近の光へ流れ込んだ。','断った光のすべてが、ひとつの星になった。'][this.state.depth];
  }

  private updateUi(): void {
    this.ui.lives.innerHTML = Array.from({ length: GAME_CONFIG.maxLives }, (_, index) => `<span class="life${index >= this.state.lives ? ' is-lost' : ''}" aria-hidden="true"></span>`).join('');
    this.ui.lives.setAttribute('aria-label', `残機 ${this.state.lives}`);
    this.ui.progress.style.setProperty('--flight-progress', `${this.state.elapsed / GAME_CONFIG.flightDuration}`);
  }

  private animate = (): void => {
    const delta = Math.min(this.clock.getDelta(), .05), elapsed = this.clock.elapsedTime;
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    this.shipRoot.position.y = -1.65 + Math.sin(elapsed * 1.7) * .07; this.reticle.rotation.z = elapsed * .18; this.targetStar.rotation.y = elapsed * .1;
    if (this.hitStop > 0) this.hitStop -= delta;
    else if (this.state.phase === 'playing') this.updatePlaying(delta);
    else if (this.state.phase === 'approach') this.updateApproach(delta);
    this.composer.render(); requestAnimationFrame(this.animate);
  };

  private removeProjectile(): void { if (this.projectile) { this.disposeObject(this.projectile.mesh); this.projectile = null; } }
  private removeTrace(index: number): void { const [trace] = this.traces.splice(index, 1); if (trace) this.disposeObject(trace.group); }
  private clearHazards(): void { while (this.traces.length) this.removeTrace(this.traces.length - 1); this.removeProjectile(); }
  private clearObjects(): void { this.clearHazards(); while (this.afterimages.length) { const image = this.afterimages.pop(); if (image) this.disposeObject(image); } }
  private disposeObject(object: THREE.Object3D): void { object.removeFromParent(); object.traverse((child) => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose()); } }); }
  private seededRandom(seed: number): () => number { let value = seed; return () => { value = value * 16807 % 2147483647; return (value - 1) / 2147483646; }; }
}

export type { UiElements };
