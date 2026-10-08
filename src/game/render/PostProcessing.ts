import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const CINEMATIC_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    aspect: { value: 1 },
    sunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    sunVisibility: { value: 0 },
    aberration: { value: 0.0015 },
    impact: { value: 0 },
    nova: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float aspect;
    uniform vec2 sunScreen;
    uniform float sunVisibility;
    uniform float aberration;
    uniform float impact;
    uniform float nova;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    vec3 ghost(vec2 uv, vec2 center, float radius, vec3 color) {
      vec2 d = uv - center;
      d.x *= aspect;
      float r = length(d);
      return color * smoothstep(radius, radius * 0.55, r) * 0.45;
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float edge = dot(centered, centered);
      float shift = aberration * (1.0 + impact * 6.0) * edge * 4.0;
      vec2 direction = normalize(centered + 1e-5);
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + direction * shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - direction * shift).b;

      // lens flare: 太陽の画面位置から中心を通る軸上に色付きのghostを並べる。
      if (sunVisibility > 0.0) {
        vec2 axis = vec2(0.5) - sunScreen;
        vec3 flare = vec3(0.0);
        flare += ghost(vUv, sunScreen + axis * 0.55, 0.035, vec3(0.25, 0.5, 1.0));
        flare += ghost(vUv, sunScreen + axis * 0.9, 0.06, vec3(0.2, 1.0, 0.6) * 0.5);
        flare += ghost(vUv, sunScreen + axis * 1.35, 0.11, vec3(1.0, 0.45, 0.2) * 0.35);
        flare += ghost(vUv, sunScreen + axis * 1.8, 0.05, vec3(0.7, 0.4, 1.0) * 0.5);
        flare += ghost(vUv, sunScreen + axis * 2.2, 0.16, vec3(0.3, 0.7, 1.0) * 0.18);
        vec2 toSun = vUv - sunScreen;
        toSun.x *= aspect;
        float streak = exp(-abs(toSun.y) * 220.0) * exp(-abs(toSun.x) * 2.2);
        float halo = smoothstep(0.015, 0.0, abs(length(toSun) - 0.28)) * 0.035;
        flare += vec3(0.55, 0.75, 1.0) * streak * 1.2 + vec3(0.6, 0.8, 1.0) * halo;
        float onScreen = smoothstep(0.0, 0.08, min(min(sunScreen.x, 1.0 - sunScreen.x), min(sunScreen.y, 1.0 - sunScreen.y)) + 0.08);
        color += flare * sunVisibility * onScreen * 0.2;
      }

      // NOVA使用時の白い閃光と、被弾時の赤い縁。
      color += vec3(0.9, 0.95, 1.0) * nova;
      color = mix(color, color * vec3(1.4, 0.55, 0.6) + vec3(0.12, 0.0, 0.02), impact * smoothstep(0.08, 0.35, edge));

      // 軽いcolor grade: 影を青へ、ハイライトを暖色へ。
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color * vec3(0.92, 0.98, 1.1), color * vec3(1.06, 1.0, 0.94), smoothstep(0.05, 0.8, luminance));

      float vignette = smoothstep(0.85, 0.2, edge * 2.2);
      color *= mix(0.55, 1.0, vignette);
      float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(time * 13.7)) - 0.5;
      color += grain * 0.018;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostProcessing {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cinematic: ShaderPass;
  private readonly fxaa: ShaderPass;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // HalfFloatのMSAAはANGLE/Metalでresolveが重いため、tone mapping後のFXAAで輪郭を整える。
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.42, 1.0);
    // 太陽芯などの極端なHDR画素が低解像度mipで四角く広がらないよう、bloom入力の輝度を頭打ちにする。
    const highPass = this.bloom.materialHighPassFilter;
    highPass.fragmentShader = highPass.fragmentShader.replace(
      'gl_FragColor = mix( outputColor, texel, alpha );',
      'texel.rgb *= min( 1.0, 2.5 / max( v, 1e-4 ) ); gl_FragColor = mix( outputColor, texel, alpha );',
    );
    highPass.needsUpdate = true;
    highPass.uniforms.smoothWidth.value = 0.35;
    this.composer.addPass(this.bloom);
    this.cinematic = new ShaderPass(CINEMATIC_SHADER);
    this.composer.addPass(this.cinematic);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
  }

  setSize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.fxaa.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    this.cinematic.uniforms.aspect.value = width / Math.max(1, height);
  }

  update(elapsed: number, sunScreen: THREE.Vector2, sunVisibility: number, impact: number, nova: number, bloomBoost: number): void {
    const uniforms = this.cinematic.uniforms;
    uniforms.time.value = elapsed;
    uniforms.sunScreen.value.copy(sunScreen);
    uniforms.sunVisibility.value = sunVisibility;
    uniforms.impact.value = impact;
    uniforms.nova.value = nova;
    this.bloom.strength = 0.85 + bloomBoost;
  }

  render(): void {
    this.composer.render();
  }
}
