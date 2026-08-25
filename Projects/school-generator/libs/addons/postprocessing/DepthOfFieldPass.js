/**
 * DepthOfFieldPass — a compact circle-of-confusion blur for the School
 * Generator's photo mode.
 *
 * Written for this project rather than vendored: three.js ships BokehPass, but
 * this repo carries only the handful of addons it actually uses, and the
 * requirement here is narrower than BokehPass's — one focus plane, one
 * aperture, no bokeh shape, no depth-of-field-from-a-picked-point machinery.
 * What that buys is a pass that is ~130 lines instead of ~400 and that reuses
 * the same "render the scene again into my own target for its depth" trick
 * SSAOPass already uses in this directory.
 *
 * How it works:
 *
 *   1. Render the scene once more into a private render target that carries a
 *      DepthTexture, with a cheap opaque override material. Colour is thrown
 *      away; only the depth buffer matters, and the override keeps the extra
 *      pass from paying for the real materials a second time. (It also means
 *      glazing writes depth here even though it doesn't in the beauty pass,
 *      which is what you want: a window should be able to be out of focus.)
 *   2. Linearize that depth to view-space distance, compare it against the
 *      focus distance, and turn the difference into a circle-of-confusion
 *      radius in pixels.
 *   3. Blur with a 13-tap sunflower disc scaled by that radius. Taps are
 *      rejected if they come from something much nearer than the centre pixel,
 *      which is the cheap fix for foreground colour bleeding over a sharp
 *      subject.
 *
 * Costs one extra scene render per frame, so photo mode is the only place it
 * is switched on.
 */

import {
  DepthTexture,
  DepthStencilFormat,
  MeshBasicMaterial,
  NearestFilter,
  ShaderMaterial,
  UnsignedInt248Type,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';

const DepthOfFieldShader = {
  name: 'DepthOfFieldShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    cameraNear: { value: 0.3 },
    cameraFar: { value: 1200 },
    focus: { value: 30 },        // world units to the focus plane
    aperture: { value: 2.8 },    // f-number; smaller = shallower
    maxBlur: { value: 8 },       // px, the cap on the circle of confusion
    resolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>

    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float focus;
    uniform float aperture;
    uniform float maxBlur;
    uniform vec2 resolution;

    // 13 taps on a sunflower spiral: even coverage, no visible spokes, and
    // few enough that this stays a one-pass blur.
    const int TAPS = 13;

    float rawDepth( vec2 uv ) {
      return texture2D( tDepth, uv ).x;
    }

    float viewDistance( vec2 uv ) {
      float viewZ = perspectiveDepthToViewZ( rawDepth( uv ), cameraNear, cameraFar );
      return -viewZ;
    }

    // Anything effectively at infinity — the sky dome, the sun, the far end of
    // the ground plane — is left sharp. A real lens focused at twenty feet
    // does blur the sky, but the sky here is a smooth gradient where the blur
    // is invisible, and the two things that aren't smooth (the sun's disc and
    // the building's silhouette against it) are exactly what you don't want
    // smeared. Perspective depth is heavily non-linear, so with this scene's
    // near plane 0.9995 lands somewhere past 600ft.
    bool atInfinity( vec2 uv ) {
      return rawDepth( uv ) >= 0.9995;
    }

    // Circle of confusion in pixels. The thin-lens relation says the blur
    // grows with the *relative* distance error, which is why this divides by
    // the focus distance rather than by a fixed range: refocusing on something
    // 4ft away goes shallow, refocusing across a courtyard stays sharp.
    float coc( float dist ) {
      float delta = abs( dist - focus ) / max( 0.5, focus );
      return clamp( delta * ( 12.0 / max( 0.7, aperture ) ), 0.0, 1.0 ) * maxBlur;
    }

    void main() {
      float centreDist = viewDistance( vUv );
      float centreCoc = coc( centreDist );
      vec4 base = texture2D( tDiffuse, vUv );

      if ( atInfinity( vUv ) || centreCoc < 0.75 ) {
        gl_FragColor = base;
        return;
      }

      vec2 px = 1.0 / resolution;
      vec3 sum = base.rgb;
      float weight = 1.0;
      float golden = 2.39996323;

      for ( int i = 0; i < TAPS; i ++ ) {
        float fi = float( i ) + 1.0;
        float r = sqrt( fi / float( TAPS ) );
        float a = fi * golden;
        vec2 offset = vec2( cos( a ), sin( a ) ) * r * centreCoc * px;
        vec2 uv = vUv + offset;

        float d = viewDistance( uv );
        // A tap much nearer than the centre pixel belongs to a foreground
        // object; letting it in smears that object's colour over a subject
        // that is meant to be sharp.
        float w = ( d < centreDist - 0.5 ) ? clamp( coc( d ) / max( 1.0, centreCoc ), 0.0, 1.0 ) : 1.0;
        sum += texture2D( tDiffuse, uv ).rgb * w;
        weight += w;
      }

      gl_FragColor = vec4( sum / weight, base.a );
    }
  `,
};

class DepthOfFieldPass extends Pass {

  constructor( scene, camera, width = 512, height = 512 ) {

    super();

    this.scene = scene;
    this.camera = camera;
    this.width = width;
    this.height = height;

    const depthTexture = new DepthTexture();
    depthTexture.format = DepthStencilFormat;
    depthTexture.type = UnsignedInt248Type;
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;

    this.depthRenderTarget = new WebGLRenderTarget( width, height, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthTexture,
    } );

    // Cheap stand-in for every material in the scene. Depth is all this pass
    // reads back, and the real materials have already been paid for once.
    this.depthMaterial = new MeshBasicMaterial();

    this.material = new ShaderMaterial( {
      name: DepthOfFieldShader.name,
      uniforms: { ...DepthOfFieldShader.uniforms },
      vertexShader: DepthOfFieldShader.vertexShader,
      fragmentShader: DepthOfFieldShader.fragmentShader,
    } );
    this.material.uniforms.tDepth.value = depthTexture;
    this.material.uniforms.resolution.value.set( width, height );

    this.fsQuad = new FullScreenQuad( this.material );

  }

  get focus() { return this.material.uniforms.focus.value; }
  set focus( v ) { this.material.uniforms.focus.value = v; }

  get aperture() { return this.material.uniforms.aperture.value; }
  set aperture( v ) { this.material.uniforms.aperture.value = v; }

  get maxBlur() { return this.material.uniforms.maxBlur.value; }
  set maxBlur( v ) { this.material.uniforms.maxBlur.value = v; }

  render( renderer, writeBuffer, readBuffer ) {

    const oldTarget = renderer.getRenderTarget();
    const oldOverride = this.scene.overrideMaterial;

    this.scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget( this.depthRenderTarget );
    renderer.clear();
    renderer.render( this.scene, this.camera );
    this.scene.overrideMaterial = oldOverride;

    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;

    if ( this.renderToScreen ) {
      renderer.setRenderTarget( null );
      this.fsQuad.render( renderer );
    } else {
      renderer.setRenderTarget( writeBuffer );
      if ( this.clear ) renderer.clear();
      this.fsQuad.render( renderer );
    }

    renderer.setRenderTarget( oldTarget );

  }

  setSize( width, height ) {

    this.width = width;
    this.height = height;
    this.depthRenderTarget.setSize( width, height );
    this.material.uniforms.resolution.value.set( width, height );

  }

  dispose() {

    this.depthRenderTarget.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.fsQuad.dispose();

  }

}

export { DepthOfFieldPass, DepthOfFieldShader };
