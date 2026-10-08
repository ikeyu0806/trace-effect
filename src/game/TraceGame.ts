import * as THREE from 'three';
import { loadGameAssets } from './assets';
import { GAME_CONFIG, HAZARD_STATS, ITEM_PRESENTATION, type HazardKind, type ItemKind, WEAPON_IDS, type WeaponId } from './config';
import { Explosions } from './fx/Explosions';
import { HazardField, type Hazard } from './Hazards';
import { ItemField } from './ItemField';
import { chooseDrop } from './drops';
import { GLOW_TEXTURE, PlayerShip } from './PlayerShip';
import { PostProcessing } from './render/PostProcessing';
import { SpaceBackdrop, SUN_DIRECTION } from './render/SpaceBackdrop';
import { advanceFlight, collectItem, comboMultiplier, consumeNova, createGameState, flightIntensity, registerCut, resolveCollision, type GameState } from './state';
import { WeaponSystem } from './WeaponSystem';

export interface UiElements {
  loading: HTMLElement;
  loadingProgress: HTMLElement;
  intro: HTMLElement;
  startButton: HTMLButtonElement;
  hud: HTMLElement;
  lives: HTMLElement;
  shield: HTMLElement;
  nova: HTMLElement;
  score: HTMLElement;
  combo: HTMLElement;
  weapon: HTMLElement;
  weaponName: HTMLElement;
  weaponLevel: HTMLElement;
  overdrive: HTMLElement;
  toast: HTMLElement;
  itemTags: HTMLElement;
  progress: HTMLElement;
  pause: HTMLElement;
  end: HTMLElement;
  endTitle: HTMLElement;
  endScore: HTMLElement;
  endKills: HTMLElement;
  restartButton: HTMLButtonElement;
  status: HTMLElement;
}

interface World {
  ship: PlayerShip;
  hazards: HazardField;
  items: ItemField;
  weapons: WeaponSystem;
}

const SHIP_HOME = new THREE.Vector3(0, -1.65, 0);
const CAMERA_HOME = new THREE.Vector3(0, 5.6, 12.5);
const CAMERA_TARGET = new THREE.Vector3(0, -0.25, -13);
const DUST_COUNT = 900;
const MAX_PIXEL_RATIO = 1.5;
const MIN_RENDER_SCALE = 0.55;

export class TraceGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly post: PostProcessing;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2600);
  private readonly clock = new THREE.Clock();
  private readonly backdrop = new SpaceBackdrop();
  private readonly explosions = new Explosions();
  private readonly reticle = new THREE.Group();
  private readonly targetStar = new THREE.Group();
  private readonly dust: THREE.LineSegments;
  private readonly dustPositions: Float32Array;
  private readonly dustColors: Float32Array;
  private world: World | null = null;
  private state: GameState = createGameState();

  private spawnTimer = 1.2;
  private crystalTimer: number = GAME_CONFIG.crystalInterval * 0.6;
  private hitStop = 0;
  private approachTime = 0;
  private endDelay = 0;
  private shake = 0;
  private impact = 0;
  private novaFlash = 0;
  private novaRadius: number | null = null;
  private readonly novaOrigin = new THREE.Vector3();
  private worldSpeed: number = GAME_CONFIG.hazardSpeedStart;

  private pointerX = 0;
  private pointerY = 0;
  private targetX = SHIP_HOME.x;
  private targetY = SHIP_HOME.y;
  private shipVelocityX = 0;
  private pointerFiring = false;
  private spacePressed = false;
  private readonly keys = new Set<string>();
  private hudKey = '';
  private renderScale = 1;
  private frameTimeAverage = 1 / 60;
  private lastFrameTime = 0;
  private scaleCooldown = 2;
  private readonly sunScreen = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private readonly ui: UiElements) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene.fog = new THREE.FogExp2(0x070c1c, 0.0052);
    this.camera.position.copy(CAMERA_HOME);
    this.camera.lookAt(CAMERA_TARGET);

    this.scene.add(this.backdrop.group, this.explosions.group);
    this.backdrop.bake(this.renderer);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(this.backdrop.createEnvironmentScene(), 0.04, 1, 4000).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.9;

    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    ({ dust: this.dust, positions: this.dustPositions, colors: this.dustColors } = this.createDust());
    this.scene.add(this.dust);
    this.buildLights();
    this.createTargetStar();
    this.createReticle();
    this.bindEvents();
    this.resize();
    void this.load();
    this.renderer.setAnimationLoop(this.animate);
    if (import.meta.env.DEV) Object.assign(window, { __trace: this });
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x120a14, 0.55));
    // 画面奥の太陽から差す暖色のrim。手前から見ると機体と隕石の輪郭に光が回る。
    const sunLight = new THREE.DirectionalLight(0xffe2bc, 3.4);
    sunLight.position.copy(SUN_DIRECTION).multiplyScalar(60);
    this.scene.add(sunLight);
    // カメラ左上後方からのkey。形状の読みやすさを担う。
    const key = new THREE.DirectionalLight(0xd8e8ff, 2.3);
    key.position.set(-8, 12, 14);
    this.scene.add(key);
    // 右下の氷惑星側から返る青い照り返し。
    const bounce = new THREE.DirectionalLight(0x4f8dff, 1.2);
    bounce.position.set(10, -6, -4);
    this.scene.add(bounce);
  }

  private createDust(): { dust: THREE.LineSegments; positions: Float32Array; colors: Float32Array } {
    const positions = new Float32Array(DUST_COUNT * 6);
    const colors = new Float32Array(DUST_COUNT * 6);
    for (let index = 0; index < DUST_COUNT; index += 1) {
      const x = (Math.random() - 0.5) * 90;
      const y = (Math.random() - 0.35) * 46;
      const z = -Math.random() * 180 + 14;
      positions.set([x, y, z, x, y, z - 1], index * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const dust = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    dust.frustumCulled = false;
    return { dust, positions, colors };
  }

  private createTargetStar(): void {
    const glow = (color: number, gain: number, scale: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: GLOW_TEXTURE(), color: new THREE.Color(color).multiplyScalar(gain), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      );
      sprite.scale.setScalar(scale);
      return sprite;
    };
    this.targetStar.add(glow(0xffffff, 6, 1.6), glow(0x8fdcff, 2, 5), glow(0x4f8dff, 0.6, 14));
    this.targetStar.position.set(0, 4.5, -140);
    this.scene.add(this.targetStar);
  }

  private createReticle(): void {
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(0xaaf6ff).multiplyScalar(1.6), transparent: true, opacity: 0.85, fog: false });
    const ring = new THREE.EllipseCurve(0, 0, 0.55, 0.55, 0, Math.PI * 2).getPoints(48).map((point) => new THREE.Vector3(point.x, point.y, 0));
    this.reticle.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), material));
    const ticks: THREE.Vector3[] = [];
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2;
      const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      ticks.push(direction.clone().multiplyScalar(0.7), direction.clone().multiplyScalar(1.05));
    }
    this.reticle.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), material));
    this.reticle.position.set(0, 0.6, -18);
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  private async load(): Promise<void> {
    try {
      const assets = await loadGameAssets((ratio) => this.ui.loadingProgress.style.setProperty('--loaded', `${ratio}`));
      const ship = new PlayerShip(assets.ship, this.scene);
      ship.root.position.copy(SHIP_HOME);
      ship.root.rotation.set(0.04, Math.PI, 0);
      this.scene.add(ship.root);
      ship.resetTrails();
      const world: World = {
        ship,
        hazards: new HazardField(assets, this.scene),
        items: new ItemField(assets.itemCapsule, this.scene, this.ui.itemTags),
        weapons: new WeaponSystem(this.scene, this.explosions, assets.missile, ship),
      };
      await this.prewarm(assets);
      this.world = world;
      this.ui.loading.hidden = true;
      this.ui.intro.hidden = false;
      this.ui.startButton.focus();
    } catch (error) {
      console.error(error);
      this.ui.loading.innerHTML = '<div><p class="eyebrow">TRACE EFFECT</p><p>モデルを読み込めませんでした</p></div>';
    }
  }

  /** 最初の撃破や取得でshader compileの引っかかりが出ないよう、代表物を一度描いておく。 */
  private async prewarm(assets: Awaited<ReturnType<typeof loadGameAssets>>): Promise<void> {
    const staging = new THREE.Group();
    staging.position.set(0, 0, -40);
    for (const template of [...assets.asteroids, assets.crystalAsteroid, ...assets.debris, assets.itemCapsule, assets.missile]) {
      staging.add(template.clone(true));
    }
    this.scene.add(staging);
    const hidden: THREE.Object3D[] = [];
    this.explosions.group.traverse((child) => {
      if (!child.visible) {
        child.visible = true;
        hidden.push(child);
      }
    });
    await this.renderer.compileAsync(this.scene, this.camera);
    for (const child of hidden) child.visible = false;
    staging.removeFromParent();
  }

  private bindEvents(): void {
    this.ui.startButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.start();
    });
    this.ui.restartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.reset();
      this.start();
    });
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('contextmenu', (event) => {
      if (this.state.phase === 'playing') event.preventDefault();
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.state.phase !== 'playing') return;
    this.pointerX = THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
    this.pointerY = THREE.MathUtils.clamp(1 - (event.clientY / window.innerHeight) * 2, -1, 1);
    this.targetX = this.pointerX * GAME_CONFIG.fieldWidth * 0.5;
    this.targetY = THREE.MathUtils.lerp(GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY, (this.pointerY + 1) * 0.5);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      if (this.state.phase === 'playing') this.triggerNova();
      return;
    }
    if (event.button !== 0) return;
    if (this.state.phase === 'ready' && this.world) this.start();
    else if (this.state.phase === 'playing') this.pointerFiring = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.pointerFiring = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && (this.state.phase === 'playing' || this.state.phase === 'paused')) this.togglePause();
    if (this.state.phase !== 'playing') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.code === 'Space') this.spacePressed = true;
    if ((event.code === 'KeyB' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !event.repeat) this.triggerNova();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'Space') this.spacePressed = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden || this.state.phase !== 'playing') return;
    this.releaseInput();
    this.togglePause();
  };

  private releaseInput(): void {
    this.keys.clear();
    this.pointerFiring = false;
    this.spacePressed = false;
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
    const drawingHeight = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.explosions.setViewport(drawingHeight, this.camera.fov);
  };

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO) * this.renderScale;
  }

  /** 実測のframe時間から描画解像度を上下させ、60fpsを保つ（dynamic resolution）。 */
  private adaptResolution(): void {
    const now = performance.now();
    const frameTime = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 1 / 60;
    this.lastFrameTime = now;
    if (document.hidden || frameTime > 0.25) return;
    this.frameTimeAverage += (frameTime - this.frameTimeAverage) * 0.05;
    this.scaleCooldown -= frameTime;
    if (this.scaleCooldown > 0) return;
    let next = this.renderScale;
    if (this.frameTimeAverage > 1 / 50) next = Math.max(MIN_RENDER_SCALE, this.renderScale - 0.1);
    else if (this.frameTimeAverage < 1 / 58 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.05);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.scaleCooldown = 1.2;
      this.resize();
    }
  }

  private start(): void {
    if (this.state.phase !== 'ready' || !this.world) return;
    this.state = { ...this.state, phase: 'playing' };
    this.ui.intro.hidden = true;
    this.ui.hud.hidden = false;
    this.reticle.visible = true;
    this.ui.status.textContent = '飛行開始';
    this.toast('LAUNCH', 0x7ee8ff);
    this.clock.getDelta();
    this.updateHud(true);
  }

  private reset(): void {
    this.state = createGameState();
    this.spawnTimer = 1.2;
    this.crystalTimer = GAME_CONFIG.crystalInterval * 0.6;
    this.hitStop = 0;
    this.approachTime = 0;
    this.endDelay = 0;
    this.novaRadius = null;
    this.novaFlash = 0;
    this.impact = 0;
    this.shake = 0;
    this.releaseInput();
    this.pointerX = 0;
    this.pointerY = 0;
    this.targetX = SHIP_HOME.x;
    this.targetY = SHIP_HOME.y;
    this.shipVelocityX = 0;
    if (this.world) {
      this.world.hazards.clear();
      this.world.items.clear();
      this.world.weapons.clear();
      this.world.ship.root.position.copy(SHIP_HOME);
      this.world.ship.root.rotation.set(0.04, Math.PI, 0);
      this.world.ship.setVisible(true);
      this.world.ship.resetTrails();
    }
    this.explosions.clear();
    this.targetStar.position.set(0, 4.5, -140);
    this.targetStar.scale.setScalar(1);
    this.ui.end.hidden = true;
    this.ui.pause.hidden = true;
    this.ui.hud.classList.remove('is-approaching');
    this.ui.status.textContent = '';
    this.updateHud(true);
  }

  private togglePause(): void {
    const paused = this.state.phase === 'playing';
    this.state = { ...this.state, phase: paused ? 'paused' : 'playing' };
    if (paused) this.releaseInput();
    this.ui.pause.hidden = !paused;
    this.ui.status.textContent = paused ? '一時停止' : '飛行再開';
    this.clock.getDelta();
  }

  private toast(text: string, color: number): void {
    const element = this.ui.toast;
    element.textContent = text;
    element.style.setProperty('--toast-color', `#${new THREE.Color(color).getHexString()}`);
    element.classList.remove('is-shown');
    void element.offsetWidth;
    element.classList.add('is-shown');
  }

  // ---- gameplay ----

  private updatePlaying(delta: number, elapsed: number, world: World): void {
    const previousLives = this.state.lives;
    this.state = advanceFlight(this.state, delta);
    if (this.state.phase === 'approach') {
      this.beginApproach(world);
      return;
    }
    const intensity = flightIntensity(this.state.elapsed);
    this.worldSpeed = THREE.MathUtils.lerp(GAME_CONFIG.hazardSpeedStart, GAME_CONFIG.hazardSpeedEnd, intensity);
    this.updateInput(delta);
    this.moveShip(delta, elapsed, world.ship);
    this.spawnHazards(delta, intensity, world);
    world.hazards.update(delta, elapsed);
    this.updateNova(delta, world);
    this.checkShipCollisions(world);

    this.aimPoint.copy(this.reticle.position);
    world.weapons.update(
      delta,
      elapsed,
      {
        weapon: this.state.weapon,
        level: this.state.weaponLevel,
        overdrive: this.state.overdrive > 0,
        firing: this.pointerFiring || this.spacePressed,
        aimPoint: this.aimPoint,
        hazards: world.hazards.hazards,
      },
      this.camera,
      this.onHazardHit,
    );
    this.cullHazards(world);
    const size = this.renderer.getSize(new THREE.Vector2());
    for (const kind of world.items.update(delta, world.ship.root.position, this.camera, size.x, size.y)) this.pickUp(kind, world);
    if (this.state.lives > previousLives && this.state.phase === 'playing') this.announceExtend(previousLives);
    this.updateHud(false);
  }

  private updateInput(delta: number): void {
    const axisX = Number(this.keys.has('ArrowRight') || this.keys.has('KeyD')) - Number(this.keys.has('ArrowLeft') || this.keys.has('KeyA'));
    const axisY = Number(this.keys.has('ArrowUp') || this.keys.has('KeyW')) - Number(this.keys.has('ArrowDown') || this.keys.has('KeyS'));
    const limit = GAME_CONFIG.fieldWidth * 0.5;
    if (axisX !== 0) {
      this.targetX = THREE.MathUtils.clamp(this.targetX + axisX * GAME_CONFIG.keyboardMoveSpeed * delta, -limit, limit);
      this.pointerX = this.targetX / limit;
    }
    if (axisY !== 0) {
      this.targetY = THREE.MathUtils.clamp(this.targetY + axisY * GAME_CONFIG.keyboardMoveSpeedY * delta, GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY);
      this.pointerY = THREE.MathUtils.mapLinear(this.targetY, GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY, -1, 1);
    }
  }

  private moveShip(delta: number, elapsed: number, ship: PlayerShip): void {
    const root = ship.root;
    const previousX = root.position.x;
    root.position.x = THREE.MathUtils.damp(root.position.x, this.targetX, 9, delta);
    root.position.y = THREE.MathUtils.damp(root.position.y, this.targetY + Math.sin(elapsed * 1.7) * 0.07, 9, delta);
    this.shipVelocityX = THREE.MathUtils.damp(this.shipVelocityX, (root.position.x - previousX) / Math.max(delta, 1e-4), 12, delta);
    root.rotation.z = THREE.MathUtils.damp(root.rotation.z, THREE.MathUtils.clamp(this.shipVelocityX * 0.05, -0.75, 0.75), 8, delta);
    root.rotation.x = THREE.MathUtils.damp(root.rotation.x, 0.04 - (this.targetY - root.position.y) * 0.12, 8, delta);
    this.reticle.position.x = THREE.MathUtils.damp(this.reticle.position.x, this.targetX * 1.35, 18, delta);
    this.reticle.position.y = THREE.MathUtils.damp(this.reticle.position.y, this.targetY + 2.25, 18, delta);
  }

  private spawnHazards(delta: number, intensity: number, world: World): void {
    this.spawnTimer -= delta;
    const maxHazards = Math.round(THREE.MathUtils.lerp(GAME_CONFIG.maxHazardsStart, GAME_CONFIG.maxHazardsEnd, intensity));
    if (this.spawnTimer <= 0 && world.hazards.hazards.length < maxHazards) {
      const roll = Math.random();
      const debrisShare = 0.2 + intensity * 0.15;
      const kind: HazardKind =
        roll < debrisShare ? 'debris' : roll < debrisShare + 0.16 ? 'asteroidLarge' : roll < debrisShare + 0.5 ? 'asteroidMedium' : 'asteroidSmall';
      const drop = kind === 'debris' && Math.random() < GAME_CONFIG.debrisItemChance ? chooseDrop(this.state, Math.random()) : null;
      this.spawnHazard(kind, drop, world);
      const interval = THREE.MathUtils.lerp(GAME_CONFIG.spawnIntervalStart, GAME_CONFIG.spawnIntervalEnd, intensity);
      this.spawnTimer = interval * (0.65 + Math.random() * 0.7);
    }
    this.crystalTimer -= delta;
    if (this.crystalTimer <= 0) {
      this.spawnHazard('crystal', chooseDrop(this.state, Math.random()), world);
      this.crystalTimer = GAME_CONFIG.crystalInterval * (0.8 + Math.random() * 0.4);
    }
  }

  private spawnHazard(kind: HazardKind, drop: ItemKind | null, world: World): void {
    const halfWidth = GAME_CONFIG.fieldWidth * 0.62;
    const start = new THREE.Vector3(
      THREE.MathUtils.randFloat(-halfWidth, halfWidth),
      THREE.MathUtils.randFloat(GAME_CONFIG.fieldMinY - 0.5, GAME_CONFIG.fieldMaxY + 2.5),
      GAME_CONFIG.spawnZ,
    );
    const ship = world.ship.root.position;
    const aimAtShip = Math.random() < 0.35;
    const target = aimAtShip
      ? new THREE.Vector3(ship.x + THREE.MathUtils.randFloatSpread(1.5), ship.y + THREE.MathUtils.randFloatSpread(1), 0)
      : new THREE.Vector3(
          start.x * 0.55 + THREE.MathUtils.randFloatSpread(4),
          THREE.MathUtils.randFloat(GAME_CONFIG.fieldMinY, GAME_CONFIG.fieldMaxY),
          0,
        );
    const speedScale = kind === 'asteroidSmall' ? 1.15 : kind === 'asteroidLarge' ? 0.82 : kind === 'debris' ? 0.95 : 1;
    const velocity = target.sub(start).normalize().multiplyScalar(this.worldSpeed * speedScale);
    world.hazards.spawn(kind, start, velocity, drop);
  }

  private readonly onHazardHit = (hazard: Hazard, damage: number): void => {
    if (!this.world || hazard.hp <= 0) return;
    if (this.world.hazards.damage(hazard, damage)) this.destroyHazard(hazard, this.world, true);
  };

  private destroyHazard(hazard: Hazard, world: World, scored: boolean): void {
    hazard.hp = 0;
    const drift = hazard.velocity.clone().multiplyScalar(0.55);
    this.explosions.explode(hazard.position, hazard.radius, hazard.style, drift);
    this.shake = Math.min(1.4, this.shake + hazard.radius * 0.14);
    if (hazard.kind === 'asteroidLarge' || hazard.kind === 'crystal') this.hitStop = Math.max(this.hitStop, GAME_CONFIG.hitStopDuration);
    if (scored) {
      this.state = registerCut(this.state, HAZARD_STATS[hazard.kind].points);
      const split = hazard.kind === 'asteroidLarge' ? 'asteroidMedium' : hazard.kind === 'asteroidMedium' && Math.random() < 0.6 ? 'asteroidSmall' : null;
      if (split) {
        for (const side of [-1, 1]) {
          const offset = new THREE.Vector3(side * hazard.radius * 0.5, THREE.MathUtils.randFloatSpread(hazard.radius * 0.4), 0);
          const velocity = hazard.velocity.clone().add(new THREE.Vector3(side * THREE.MathUtils.randFloat(3, 7), THREE.MathUtils.randFloatSpread(4), 0));
          world.hazards.spawn(split, hazard.position.clone().add(offset), velocity).age = 1;
        }
      }
      if (hazard.drop) world.items.spawn(hazard.drop, hazard.position, hazard.velocity);
    }
    world.hazards.remove(hazard);
  }

  private cullHazards(world: World): void {
    for (const hazard of [...world.hazards.hazards]) {
      if (hazard.hp <= 0) world.hazards.remove(hazard);
      else if (hazard.position.z > 16) world.hazards.remove(hazard);
    }
  }

  private checkShipCollisions(world: World): void {
    const ship = world.ship.root.position;
    for (const hazard of [...world.hazards.hazards]) {
      if (hazard.hp <= 0 || Math.abs(hazard.position.z - ship.z) > hazard.radius + 0.8) continue;
      const lateral = Math.hypot(hazard.position.x - ship.x, hazard.position.y - ship.y);
      if (lateral > hazard.radius * 0.85 + GAME_CONFIG.shipHitRadius) continue;
      const { state, outcome } = resolveCollision(this.state);
      if (outcome === 'ignored') continue;
      this.state = state;
      this.destroyHazard(hazard, world, false);
      if (outcome === 'shieldBroken') {
        world.ship.flashShield();
        this.shake = Math.min(1.6, this.shake + 0.6);
        this.impact = Math.max(this.impact, 0.35);
        this.toast('SHIELD BREAK', ITEM_PRESENTATION.shield.color);
        this.ui.status.textContent = 'シールドが被弾を防いだ';
      } else {
        this.shake = 1.6;
        this.impact = 1;
        this.flashImpact();
        this.explosions.explode(ship, 0.9, 'ship', new THREE.Vector3(0, 0, 6));
        if (outcome === 'gameover') {
          world.ship.setVisible(false);
          this.explosions.explode(ship, 2.2, 'ship', new THREE.Vector3(0, 0, 4));
          this.endDelay = 2.2;
          this.reticle.visible = false;
          this.releaseInput();
          this.ui.status.textContent = '機体を失った';
        } else {
          this.toast(`LIFE LOST  ×${this.state.lives}`, 0xff4a6a);
          this.ui.status.textContent = `被弾。残機${this.state.lives}`;
        }
      }
      this.updateHud(true);
      return;
    }
  }

  private pickUp(kind: ItemKind, world: World): void {
    const before = this.state;
    this.state = collectItem(this.state, kind);
    const presentation = ITEM_PRESENTATION[kind];
    const color = new THREE.Color(presentation.color);
    const position = world.ship.root.position;
    this.explosions.burst(position, color.clone().multiplyScalar(2), 40, 14, 0.5, 0.6);
    this.explosions.ring(position, 1, 9, 0.45, color);
    let text = presentation.label;
    if ((WEAPON_IDS as readonly string[]).includes(kind)) {
      text = before.weapon === kind && before.weaponLevel >= GAME_CONFIG.maxWeaponLevel ? `${presentation.label} MAX +1000` : `${presentation.label} LV${this.state.weaponLevel}`;
    } else if (this.state.score > before.score && this.state.lives === before.lives) {
      text = `${presentation.label} +${this.state.score - before.score}`;
    }
    this.toast(text, presentation.color);
    this.ui.status.textContent = `${presentation.label}を取得`;
    if (this.state.lives > before.lives && kind !== 'life') this.announceExtend(before.lives);
    this.updateHud(true);
  }

  private announceExtend(previousLives: number): void {
    if (this.state.lives <= previousLives) return;
    this.toast('EXTEND', ITEM_PRESENTATION.life.color);
    this.ui.status.textContent = `残機が増えた。残機${this.state.lives}`;
  }

  private triggerNova(): void {
    if (!this.world) return;
    const next = consumeNova(this.state);
    if (!next) return;
    this.state = next;
    this.novaOrigin.copy(this.world.ship.root.position);
    this.novaRadius = 0;
    this.novaFlash = 1;
    this.shake = 1.4;
    const red = new THREE.Color(ITEM_PRESENTATION.nova.color).multiplyScalar(2);
    this.explosions.ring(this.novaOrigin, 2, 70, 0.9, red);
    this.explosions.ring(this.novaOrigin, 1, 40, 0.6, new THREE.Color(2, 2, 2));
    this.explosions.burst(this.novaOrigin, red, 160, 40, 0.6, 0.9);
    this.toast('NOVA', ITEM_PRESENTATION.nova.color);
    this.ui.status.textContent = 'NOVAで周囲を一掃';
    this.updateHud(true);
  }

  /** NOVAの衝撃波は速さ140で広がり、届いたものから順に破壊する。 */
  private updateNova(delta: number, world: World): void {
    if (this.novaRadius === null) return;
    this.novaRadius += delta * 140;
    for (const hazard of [...world.hazards.hazards]) {
      if (hazard.hp > 0 && hazard.position.distanceTo(this.novaOrigin) < this.novaRadius) this.destroyHazard(hazard, world, true);
    }
    if (this.novaRadius > Math.abs(GAME_CONFIG.spawnZ) + 20) this.novaRadius = null;
  }

  private beginApproach(world: World): void {
    for (const hazard of [...world.hazards.hazards]) this.destroyHazard(hazard, world, false);
    world.items.clear();
    this.releaseInput();
    this.reticle.visible = false;
    this.ui.status.textContent = '目的の星へ最接近';
    this.ui.hud.classList.add('is-approaching');
    this.toast('DESTINATION', 0xfff1bf);
  }

  private updateApproach(delta: number, world: World): void {
    this.approachTime += delta;
    const t = Math.min(1, this.approachTime / 3.6);
    const eased = 1 - Math.pow(1 - t, 3);
    this.targetStar.position.z = THREE.MathUtils.lerp(-70, -16, eased);
    this.targetStar.position.y = THREE.MathUtils.lerp(4.5, 2.5, eased);
    this.targetStar.scale.setScalar(THREE.MathUtils.lerp(2.2, 7 + this.state.depth * 2, eased));
    this.renderer.toneMappingExposure = 1 + eased * (0.35 + this.state.depth * 0.08);
    world.ship.root.position.x = THREE.MathUtils.damp(world.ship.root.position.x, 0, 2, delta);
    world.ship.root.position.y = THREE.MathUtils.damp(world.ship.root.position.y, SHIP_HOME.y, 2, delta);
    world.ship.root.rotation.z = THREE.MathUtils.damp(world.ship.root.rotation.z, 0, 3, delta);
    if (t >= 1) this.finish(true);
  }

  private finish(completed: boolean): void {
    if (completed) {
      const bonus = this.state.lives * 3000;
      this.state = { ...this.state, phase: 'complete', score: this.state.score + bonus };
    }
    this.releaseInput();
    this.renderer.toneMappingExposure = 1;
    this.ui.hud.hidden = true;
    this.ui.hud.classList.remove('is-approaching');
    this.ui.end.hidden = false;
    this.ui.end.dataset.result = completed ? 'complete' : 'gameover';
    this.ui.endTitle.textContent = completed ? 'GAME CLEAR' : 'GAME OVER';
    this.ui.endScore.textContent = this.state.score.toLocaleString('en-US');
    this.ui.endKills.textContent = `${this.state.kills}`;
    this.ui.restartButton.focus();
  }

  private flashImpact(): void {
    document.body.classList.remove('is-hit');
    requestAnimationFrame(() => document.body.classList.add('is-hit'));
    window.setTimeout(() => document.body.classList.remove('is-hit'), 180);
  }

  // ---- presentation ----

  private updateHud(force: boolean): void {
    const state = this.state;
    const ui = this.ui;
    ui.score.textContent = state.score.toLocaleString('en-US');
    ui.progress.style.setProperty('--flight-progress', `${state.elapsed / GAME_CONFIG.flightDuration}`);
    ui.overdrive.hidden = state.overdrive <= 0;
    if (state.overdrive > 0) ui.overdrive.style.setProperty('--overdrive', `${state.overdrive / GAME_CONFIG.overdriveDuration}`);
    const multiplier = comboMultiplier(state.combo);
    const key = [state.lives, state.shield, state.novaStock, state.weapon, state.weaponLevel, state.combo, multiplier].join('|');
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    ui.lives.innerHTML = Array.from({ length: GAME_CONFIG.maxLives }, (_, index) => `<span class="life${index >= state.lives ? ' is-lost' : ''}"></span>`).join('');
    ui.lives.setAttribute('aria-label', `残機 ${state.lives}`);
    ui.shield.hidden = !state.shield;
    ui.nova.innerHTML = Array.from({ length: GAME_CONFIG.maxNovaStock }, (_, index) => `<i class="${index >= state.novaStock ? 'is-empty' : ''}"></i>`).join('');
    ui.nova.setAttribute('aria-label', `NOVA ${state.novaStock}`);
    const presentation = ITEM_PRESENTATION[state.weapon as WeaponId];
    ui.weapon.style.setProperty('--item-color', `#${new THREE.Color(presentation.color).getHexString()}`);
    ui.weaponName.textContent = presentation.label;
    ui.weaponLevel.innerHTML = Array.from({ length: GAME_CONFIG.maxWeaponLevel }, (_, index) => `<i class="${index >= state.weaponLevel ? 'is-empty' : ''}"></i>`).join('');
    ui.weaponLevel.setAttribute('aria-label', `LV ${state.weaponLevel}`);
    ui.combo.hidden = state.combo < 2;
    ui.combo.textContent = `${state.combo} CHAIN  ×${multiplier.toFixed(1)}`;
  }

  private updateDust(delta: number): void {
    const speed = this.worldSpeed * 1.6;
    const length = 0.4 + speed * 0.05;
    const brightness = 0.1 + this.state.depth * 0.07 + (this.state.overdrive > 0 ? 0.18 : 0);
    const positions = this.dustPositions;
    const colors = this.dustColors;
    for (let index = 0; index < DUST_COUNT; index += 1) {
      const i6 = index * 6;
      let z = positions[i6 + 2] + speed * delta;
      if (z > 14) {
        z -= 180;
        positions[i6] = positions[i6 + 3] = (Math.random() - 0.5) * 90;
        positions[i6 + 1] = positions[i6 + 4] = (Math.random() - 0.35) * 46;
      }
      positions[i6 + 2] = z;
      positions[i6 + 5] = z - length;
      const near = THREE.MathUtils.clamp((z + 160) / 170, 0, 1);
      const value = brightness * near * near;
      colors[i6] = value * 0.75;
      colors[i6 + 1] = value * 0.9;
      colors[i6 + 2] = value * 1.1;
      colors[i6 + 3] = colors[i6 + 4] = colors[i6 + 5] = 0;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.color.needsUpdate = true;
  }

  private updateCamera(delta: number, elapsed: number): void {
    const ship = this.world?.ship.root.position ?? SHIP_HOME;
    this.shake = Math.max(0, this.shake - delta * 2.2);
    const amount = this.shake * this.shake * 0.35;
    this.camera.position.set(
      CAMERA_HOME.x + ship.x * 0.22 + (Math.random() - 0.5) * amount,
      CAMERA_HOME.y + (ship.y - SHIP_HOME.y) * 0.18 + (Math.random() - 0.5) * amount,
      CAMERA_HOME.z,
    );
    this.scratch.set(CAMERA_TARGET.x + ship.x * 0.3, CAMERA_TARGET.y + (ship.y - SHIP_HOME.y) * 0.1, CAMERA_TARGET.z);
    this.camera.lookAt(this.scratch);
    this.camera.rotateZ(-(this.world?.ship.root.rotation.z ?? 0) * 0.06 + Math.sin(elapsed * 0.4) * 0.004);
  }

  private updatePost(elapsed: number, delta: number): void {
    const sun = this.backdrop.sunWorldPosition(this.scratch).project(this.camera);
    const inFront = sun.z < 1;
    this.sunScreen.set(sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5);
    const visibility = inFront ? this.backdrop.sunVisibility(this.camera) : 0;
    this.impact = Math.max(0, this.impact - delta * 2.4);
    this.novaFlash = Math.max(0, this.novaFlash - delta * 2.8);
    const bloomBoost = this.state.depth * 0.04 + (this.state.overdrive > 0 ? 0.12 : 0) + this.novaFlash * 0.3;
    this.post.update(elapsed, this.sunScreen, visibility, this.impact, Math.pow(this.novaFlash, 3) * 0.45, bloomBoost);
  }

  private readonly animate = (): void => {
    const rawDelta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    let delta = rawDelta;
    if (this.hitStop > 0) {
      this.hitStop -= rawDelta;
      delta = rawDelta * 0.08;
    }
    const world = this.world;
    const phase = this.state.phase;
    const paused = phase === 'paused';
    if (!paused) {
      if (world && phase === 'playing') this.updatePlaying(delta, elapsed, world);
      else if (world && phase === 'approach') this.updateApproach(delta, world);
      else if (world && phase === 'gameover') {
        world.hazards.update(delta, elapsed);
        this.cullHazards(world);
        if (this.endDelay > 0) {
          this.endDelay -= delta;
          if (this.endDelay <= 0) this.finish(false);
        }
      }
      if (world) {
        world.ship.update(delta, elapsed, {
          throttle: 1 + Math.min(0.4, Math.abs(this.shipVelocityX) * 0.03) + (phase === 'approach' ? 0.5 : 0),
          overdrive: this.state.overdrive > 0,
          invulnerable: this.state.invulnerable > 0 && phase === 'playing',
          worldSpeed: this.worldSpeed,
          camera: this.camera,
          exhaust: this.explosions.glow,
        });
        if (phase === 'ready') {
          world.ship.root.position.y = SHIP_HOME.y + Math.sin(elapsed * 1.2) * 0.12;
          world.ship.root.rotation.z = Math.sin(elapsed * 0.7) * 0.08;
        }
        world.ship.setShield(this.state.shield);
      }
      this.reticle.rotation.z = elapsed * 0.6;
      this.targetStar.position.z = phase === 'approach' ? this.targetStar.position.z : THREE.MathUtils.lerp(-140, -70, flightIntensity(this.state.elapsed));
      if (phase !== 'approach') this.targetStar.scale.setScalar(THREE.MathUtils.lerp(1, 2.2, flightIntensity(this.state.elapsed)));
      this.explosions.update(delta, this.camera);
      this.updateDust(delta);
      this.updateCamera(rawDelta, elapsed);
    }
    this.backdrop.update(elapsed, flightIntensity(this.state.elapsed), this.camera);
    this.updatePost(elapsed, rawDelta);
    this.post.render();
    this.adaptResolution();
  };
}
