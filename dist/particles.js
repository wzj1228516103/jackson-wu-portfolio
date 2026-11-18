(() => {
  "use strict";

  const THREE = window.THREE;
  const glyphTextureSize = 64;
  const matcapUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAFH0lEQVR42oWX6XIcNwyEcXFmtXJs2Y7fPg+YKicuq2LJexDd+UFyjtU6Ye0xmhU+NkAQxOgfJDiGbL7ED64qBPJ6ui53b9+xWq8E4XQsbqYiJAHUvF5eznchQb4lfJyLu6mqsAEysx4v529vBGwUyPj2p3kKdzUVESEIAJl1mubD6fv11ou49f/3h6lEn1/YAYmM6hFl+vnXLwEUku/fHbq9iQqFCyC9jXh53gOwiKfwy3GeSoTbXgAMZqZmZmYeX98o6Ij508NhKtEd2AqwVFM1VVU1tW+nWxeEJB+fjvM0RYSNCPQ1gEIVoiqqIiLy6fnHAIxlFPLd03GepxLubqYqmxBqqqaoigrbff5DCikLgPL4dDzMU4kWARMRIWlQVU1NkW7ZUoP5o9kvgPnDw2GepigeZmYyQqjaZQ9Ad+v95UwREQm0mx8f5mkqXcDwAMphT5L0FZBPfzZoNFFfHuapRIkIH0kkpIJjbnaXnIQHkPn57w3g/XGeSps/zKxnMdliZjSSqkYazRzuHuXw+LICHqeplHB3dxtrICQFqmqdQDaAOdyjTMcXEREjwc/zFOHubtYioO1TVW1JoJFFLR3dY/qtA+iHYe+m1ozGENHdsAHxKAfrgA9Tn942ttLf69dOhJtHeeiAOdzN1IZWkfaSngEqd4SYmU8N8LG4N+3tH+XeGIgBMjP3chAxcnJftYtwZN1yuSBEZOuQe4gYp5Z7Qy+XFOhpcEeLDDfCJfjQFl5HwnFI2JT5xVjbZ3PIzEoGi6uu85O6AXRjUrj6tEhQM5egj+3ShcOEuu68LmRLWPWYSSzVp1UwhUGV2v98Q1ghqiJqFrMu6mFQGEWGfasdG8KNCFWNcF3cJRTt9ihcuCG0MthC00AWo16AMEIJ6TVkFC/uTs+xSt0n1dBleoOKiu4BBAlgUGQ5f6UTgkISBAFVhaj0RV0LIG9UDJZQtBVVEIRB2wa6BdyzXpMk+uwA2nIae14tiQACuKcEJCWyOTgALcl2udh/X+MxqKQIIzFGj52a7KI4JKyhxAIVMq4AgDRkm9SUw4W9hDHteAEgBXGqmUjLoXxVsAtjM8ByCQAQssalZqYDSN0rEO5TYSA2BBII1sxMU9Xug26i+AawHSkkJHg+lEwbMTC26qKbw3ive7EHiZTgy2ONXE8z5Vpf9uuwWgKZmQR4leD5UmJzmhlHZefGh97sITPbRzYBKUE5TVtAj8GaCYJ2oDPb5N0+AaCKhPDboawn+i1A3iroOgjg1DqUUzFrTZnvAdtMwDp5bQKI2luc75M3F5xOmN6L4haQWSuJzFMHXF7dmgNOM9h/A2rWWgEgK0aT9XfpnT3NrDVmondcSGTWrFlBZObr0qXJD+8hNGuthejtOo4Y1qzXdn2RFfAcqsJCeAfslmFJ5eZBs6/X8wbAryYkA/AdYLuM2QEVSGStr0ubRyHlm/a+dvVhu51AJBJZs7KF4qdsASLX7wQQMQB6o2BZxBb/es4tQETkxPcA0FulviFHDMAeQrT419NFVkC/Oj9nZvEwV7upi8tTCwkkaj0v9hLrWXl5zqwlfRuFDmg7iS2Wtf7M9YCNzXmfz9fWMfaFWEr7OBnaE+D1ddskxK7/ec1rKa1nMtENYKxFZl7O8muAnM/H6r3j123fMh5e6utNzxW3TdirHXIThTWhAaCeIP8HELzKIVxtW9naU0493en64l5behJvz95tS7E9wufdFvYuQCRTxKI/+hAV8qvxLymYe1EUYypWAAAAAElFTkSuQmCC";

  const fullscreenVertex = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const simulateFragment = `
    uniform sampler2D uPosition;
    uniform sampler2D uOrigin;
    uniform sampler2D uRandom;
    uniform sampler2D uVelocity;
    uniform sampler2D uDensity;
    uniform mat4 uViewProjection;
    uniform mat4 uGroupWorld;
    uniform mat3 uCameraRotation;
    uniform float uTime;
    uniform float uHZ;
    varying vec2 vUv;

    vec3 unit(vec3 v) {
      return v * inversesqrt(max(dot(v, v), 1e-16));
    }

    float shape(vec3 p) {
      float radiusSquared = dot(p, p);
      if (radiusSquared > 0.64) return sqrt(radiusSquared) - 0.7;

      p.z = sqrt(p.z * p.z + 0.0215) - sqrt(0.012);
      // Rotation by the unit quaternion (0.5, 0.5, 0.5, 0.5).
      p = p.zxy;

      // Harmonics of the ring angle bend the spine and change the tube section.
      vec2 plane = mat2(0.951, -0.309, 0.309, 0.951) * p.yz;
      plane *= vec2(0.96, 1.13);
      float radial = length(plane);
      vec2 direction = plane / max(radial, 0.0001);
      float c1 = direction.x;
      float s1 = direction.y;
      float c2 = c1 * c1 - s1 * s1;
      float s2 = 2.0 * c1 * s1;
      float c3 = c2 * c1 - s2 * s1;
      float s3 = s2 * c1 + c2 * s1;

      float spineRadius = 0.251 + 0.025 * c1 + 0.023 * s2 - 0.015 * c3;
      float spineDepth = 0.059 + 0.024 * c2 + 0.014 * s1;
      float thickness = 0.087 + 0.024 * s2 - 0.022 * s1 + 0.013 * s3;
      float bend = (p.x - spineDepth) * (0.86 + 0.18 * c2);
      return length(vec2(radial - spineRadius, bend)) - thickness;
    }

    vec3 shapeNormal(vec3 p) {
      const vec2 e = vec2(0.001, 0.0);
      return unit(vec3(
        shape(p + e.xyy) - shape(p - e.xyy),
        shape(p + e.yxy) - shape(p - e.yxy),
        shape(p + e.yyx) - shape(p - e.yyx)
      ));
    }

    // Curl of a vector potential formed by sums of sine waves.
    vec3 curlTerm(vec3 p, vec3 wave, vec3 amplitude, float phase) {
      return cross(wave, amplitude) * cos(dot(wave, p) + phase);
    }

    vec3 curlNoise(vec3 p) {
      return unit(
        curlTerm(p, vec3( 7.3,  4.1,  8.9), vec3(0.7, 0.0, 0.0), 1.7) +
        curlTerm(p, vec3(-3.4, 11.3,  6.2), vec3(0.3, 0.0, 0.0), 5.1) +
        curlTerm(p, vec3( 9.2, -7.8,  4.5), vec3(0.0, 0.7, 0.0), 0.6) +
        curlTerm(p, vec3( 5.7,  3.2, -9.1), vec3(0.0, 0.3, 0.0), 3.3) +
        curlTerm(p, vec3(-8.1,  7.4, -2.7), vec3(0.0, 0.0, 0.7), 2.9) +
        curlTerm(p, vec3( 4.8, 10.1,  5.9), vec3(0.0, 0.0, 0.3), 6.0)
      );
    }

    void main() {
      vec3 pos = texture2D(uPosition, vUv).xyz;
      vec3 origin = texture2D(uOrigin, vUv).xyz;
      if (length(pos) > 0.7) pos *= 0.5;
      pos += curlNoise(pos * 0.1 + uTime * 0.05) * 0.0002 * uHZ;

      vec3 gradient = shapeNormal(pos);
      if (dot(gradient, gradient) < 0.01) {
        gradient = unit(texture2D(uRandom, vUv).xyz - 0.5);
      }
      float sdf = shape(pos);
      pos += cross(unit(pos), gradient) * 0.0005;
      pos -= gradient * sdf * 0.5;
      pos += (origin - pos) * 0.0002 * uHZ;

      vec4 clip = uViewProjection * uGroupWorld * vec4(pos, 1.0);
      vec2 screenUV = clip.xy / clip.w * 0.5 + 0.5;
      if (all(greaterThanEqual(screenUV, vec2(0.0))) &&
          all(lessThanEqual(screenUV, vec2(1.0)))) {
        vec3 flow = vec3(texture2D(uVelocity, screenUV).xy, 0.0);
        float dye = texture2D(uDensity, screenUV).r;
        pos += uCameraRotation * flow * 0.0001 * uHZ * 0.4 * dye;
      }

      gl_FragColor = vec4(pos, 1.0);
    }
  `;

  const pointVertex = `
    attribute vec4 random;
    uniform sampler2D uPosition;
    uniform sampler2D uGlyphPoints;
    uniform sampler2D uSettledPoints;
    uniform sampler2D uFlowVelocity;
    uniform sampler2D uFlowDensity;
    uniform float uGlyphProgress;
    uniform float uAnswerFocus;
    uniform float uGlyphTextureSize;
    uniform float uSettledTextureSize;
    uniform float uSettledCount;
    uniform float uSettledTime;
    uniform float uDissolveProgress;
    uniform float uParticleSize;
    uniform float uDPR;
    uniform vec2 uPixelToClip;
    varying vec4 vRandom;
    varying float vScale;
    varying float vAnswer;
    varying float vOpacity;

    vec2 glyphDrift(vec2 glyph) {
      vec2 uv = glyph * 0.5 + 0.5;
      float contact = smoothstep(0.015, 0.28, texture2D(uFlowDensity, uv).r);
      vec2 flow = texture2D(uFlowVelocity, uv).xy;
      vec2 curl = vec2(-flow.y, flow.x) * (random.y - 0.5) * 0.65;
      vec2 drift = (flow + curl) * mix(0.62, 1.05, random.x);
      float cap = mix(18.0, 34.0, random.z);
      return drift * min(1.0, cap / max(length(drift), 0.001)) * contact * uPixelToClip;
    }

    vec2 pixelDrift(float magnitude) {
      float angle = random.y * 6.2831853;
      return vec2(cos(angle), sin(angle)) * magnitude * uPixelToClip;
    }

    void main() {
      vec3 pos = texture2D(uPosition, position.xy).xyz;
      pos *= mix(1.0, 1.5, pow(random.y, 150.0));
      vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
      float viewDistance = max(-viewPosition.z, 0.1);
      vScale = smoothstep(3.0, 15.0, length(viewPosition.xyz)) * mix(0.5, 1.0, random.z);
      vRandom = random;
      gl_Position = projectionMatrix * viewPosition;
      gl_PointSize = 0.04 * uDPR * 2.0 * vScale * (1000.0 / viewDistance);
      vAnswer = 0.0;
      float revealOrbit = smoothstep(0.52, 1.0, uDissolveProgress);
      vOpacity = 1.0 - uAnswerFocus * (1.0 - revealOrbit);

      if (uGlyphProgress > 0.0 || uSettledCount > 0.0) {
        vec2 cell = floor(position.xy * uParticleSize);
        float index = cell.y * uParticleSize + cell.x;
        if (uGlyphProgress > 0.0 && index < uGlyphTextureSize * uGlyphTextureSize) {
          vec2 uv = (vec2(mod(index, uGlyphTextureSize), floor(index / uGlyphTextureSize)) + 0.5) / uGlyphTextureSize;
          vec4 target = texture2D(uGlyphPoints, uv);
          if (target.z > 0.0) {
            vec2 glyph = target.xy + glyphDrift(target.xy);
            vAnswer = uGlyphProgress;
            gl_Position.xy = mix(gl_Position.xy, glyph * gl_Position.w, vAnswer);
            gl_PointSize = mix(gl_PointSize, uDPR * target.w, vAnswer);
            vOpacity = mix(vOpacity, 1.0, vAnswer);
          }
        }
        float settledIndex = uParticleSize * uParticleSize - index - 1.0;
        if (settledIndex < uSettledCount) {
          vec2 uv = (vec2(mod(settledIndex, uSettledTextureSize),
            floor(settledIndex / uSettledTextureSize)) + 0.5) / uSettledTextureSize;
          vec4 target = texture2D(uSettledPoints, uv);
          vec2 glyph = target.xy;
          if (uDissolveProgress >= 0.0) {
            float delay = random.x * 0.42;
            float fade = smoothstep(delay, delay + 0.58, uDissolveProgress);
            glyph += pixelDrift(sin(fade * 3.1415927) * mix(6.0, 34.0, random.z));
            vAnswer = 1.0 - fade;
          } else {
            float age = max(uSettledTime - target.z, 0.0);
            float burst = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.12, 0.53, age));
            float strength = 1.0 - smoothstep(target.w - 0.38, target.w, uSettledTime);
            glyph += (glyphDrift(glyph) + pixelDrift(burst * mix(4.0, 17.0, random.z))) * strength;
            vAnswer = 1.0;
          }
          gl_Position.xy = mix(gl_Position.xy, glyph * gl_Position.w, vAnswer);
          gl_PointSize = mix(gl_PointSize, uDPR * 1.45, vAnswer);
          vOpacity = mix(vOpacity, 1.0, vAnswer);
        }
      }
    }
  `;

  const pointFragment = `
    uniform sampler2D uMatcap;
    uniform float uTime;
    varying vec4 vRandom;
    varying float vScale;
    varying float vAnswer;
    varying float vOpacity;

    vec3 softLight(vec3 base, float shade) {
      vec3 darker = base - (1.0 - 2.0 * shade) * base * (1.0 - base);
      vec3 curve = mix(((16.0 * base - 12.0) * base + 4.0) * base,
                       sqrt(max(base, vec3(0.0))), step(0.25, base));
      vec3 lighter = base + (2.0 * shade - 1.0) * (curve - base);
      return mix(darker, lighter, step(0.5, shade));
    }

    vec3 overlay(vec3 base, float shade) {
      return mix(2.0 * base * shade,
                 1.0 - 2.0 * (1.0 - base) * (1.0 - shade), step(0.5, base));
    }

    void main() {
      vec2 pixel = gl_PointCoord - 0.5;
      float radius = dot(pixel, pixel);
      if (radius > 0.25 || (vScale < 0.1 && vAnswer < 0.05) || vOpacity < 0.015) discard;
      float angle = sin(uTime + vRandom.z * 20.0) * 0.5 + 1.0;
      float sine = sin(angle);
      float cosine = cos(angle);
      vec2 rotated = mat2(cosine, -sine, sine, cosine) * pixel + 0.5;
      float shade = texture2D(uMatcap, rotated).r;
      vec3 color = mix(vec3(mix(0.0, 0.2, vRandom.x)), vec3(0.6, 0.45, 1.0), pow(vRandom.z, 100.0));
      float sparkle = 0.5 + (0.4 + sin(uTime * 4.0 + vRandom.y * 20.0)) * pow(vRandom.z, 10.0) * 2.5;
      color = mix(color, softLight(color, shade), 0.8);
      color = mix(color, overlay(color, shade), 0.2);
      vec3 glyph = mix(vec3(0.66, 0.48, 1.0), vec3(1.0, 0.96, 1.0), step(0.2, vRandom.x));
      gl_FragColor = vec4(mix(max(vec3(0.0), color * sparkle), glyph, vAnswer), vOpacity);
    }
  `;

  function floatTexture(data, size) {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
  }

  function floatTarget(size) {
    return new THREE.WebGLRenderTarget(size, size, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false
    });
  }

  class AxonParticles {
    constructor(renderer, mobile) {
      this.renderer = renderer;
      this.size = mobile ? 128 : 512;
      const count = this.size * this.size;
      const initial = new Float32Array(count * 4);
      const randomness = new Float32Array(count * 4);
      const coordinates = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const origin = i * 4;
        initial[origin] = Math.random() * 2 - 1;
        initial[origin + 1] = Math.random() * 2 - 1;
        initial[origin + 2] = Math.random() * 2 - 1;
        initial[origin + 3] = 1;
        for (let j = 0; j < 4; j++) randomness[origin + j] = Math.random();
        coordinates[i * 3] = ((i % this.size) + 0.5) / this.size;
        coordinates[i * 3 + 1] = (Math.floor(i / this.size) + 0.5) / this.size;
      }

      this.origin = floatTexture(initial, this.size);
      this.randomTexture = floatTexture(randomness, this.size);
      this.zero = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      this.zero.needsUpdate = true;
      this.targets = [floatTarget(this.size), floatTarget(this.size)];
      this.current = this.origin;
      this.writeIndex = 0;

      this.compute = {
        uPosition: { value: this.origin },
        uOrigin: { value: this.origin },
        uRandom: { value: this.randomTexture },
        uVelocity: { value: this.zero },
        uDensity: { value: this.zero },
        uViewProjection: { value: new THREE.Matrix4() },
        uGroupWorld: { value: new THREE.Matrix4() },
        uCameraRotation: { value: new THREE.Matrix3() },
        uTime: { value: 0 },
        uHZ: { value: 1 }
      };
      this.simulate = new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex,
        fragmentShader: simulateFragment,
        uniforms: this.compute,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false
      });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simulate);
      this.quad.frustumCulled = false;
      this.computeScene = new THREE.Scene();
      this.computeScene.add(this.quad);
      this.computeCamera = new THREE.Camera();

      this.matcap = new THREE.TextureLoader().load(matcapUrl);
      this.settledTextureSize = mobile ? 128 : 256;
      this.glyphDuration = 0;
      this.answerFocus = 0;
      this.answerFocusTarget = 0;
      this.particleUniforms = {
        uMatcap: { value: this.matcap },
        uPosition: { value: this.origin },
        uGlyphPoints: { value: this.zero },
        uSettledPoints: { value: this.zero },
        uFlowVelocity: { value: this.zero },
        uFlowDensity: { value: this.zero },
        uGlyphProgress: { value: 0 },
        uAnswerFocus: { value: 0 },
        uGlyphTextureSize: { value: glyphTextureSize },
        uSettledTextureSize: { value: this.settledTextureSize },
        uSettledCount: { value: 0 },
        uSettledTime: { value: 0 },
        uDissolveProgress: { value: -1 },
        uParticleSize: { value: this.size },
        uTime: { value: 0 },
        uDPR: { value: renderer.getPixelRatio() },
        uPixelToClip: { value: new THREE.Vector2() }
      };
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(coordinates, 3));
      geometry.setAttribute("random", new THREE.BufferAttribute(randomness, 4));
      this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        uniforms: this.particleUniforms,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      }));
      this.points.frustumCulled = false;

      this.group = new THREE.Group();
      this.group.position.set(0.343, 0.16, -1);
      const radians = THREE.MathUtils.degToRad;
      this.group.rotation.set(radians(-28.4), radians(390), radians(4.92));
      this.group.scale.set(5, 5, 6);
      this.group.add(this.points);
    }

    resize(pixelRatio) {
      this.particleUniforms.uDPR.value = pixelRatio;
      const pixelToClip = this.particleUniforms.uPixelToClip.value;
      this.renderer.getSize(pixelToClip);
      pixelToClip.set(2 / pixelToClip.x, 2 / pixelToClip.y);
    }

    setAnswerMode(active) {
      this.answerFocusTarget = active ? 1 : 0;
    }

    setGlyph(points, startTime, duration) {
      if (!this.glyphTexture) {
        this.glyphTexture = floatTexture(new Float32Array(glyphTextureSize ** 2 * 4), glyphTextureSize);
        this.particleUniforms.uGlyphPoints.value = this.glyphTexture;
      }
      const data = this.glyphTexture.image.data;
      const pointCount = Math.min(points.length, glyphTextureSize ** 2);
      data.fill(0);
      for (let index = 0; index < pointCount; index++) {
        const [x, y] = points[index];
        const offset = index * 4;
        data[offset] = x;
        data[offset + 1] = y;
        data[offset + 2] = 1;
        data[offset + 3] = 1.45;
      }
      this.glyphStarted = startTime;
      this.glyphDuration = duration;
      this.glyphTexture.needsUpdate = true;
    }

    clearGlyph() {
      this.glyphDuration = 0;
      this.particleUniforms.uGlyphProgress.value = 0;
    }

    setSettledGlyphs(glyphs) {
      const total = glyphs.reduce((count, glyph) => count + glyph.points.length, 0);
      const side = this.settledTextureSize;
      const count = Math.min(total, side ** 2, this.size ** 2 - glyphTextureSize ** 2);
      const uniforms = this.particleUniforms;
      uniforms.uSettledCount.value = count;
      if (!count) return;
      if (!this.settledTexture) {
        this.settledTexture = floatTexture(new Float32Array(side ** 2 * 4), side);
        uniforms.uSettledPoints.value = this.settledTexture;
      }

      const data = this.settledTexture.image.data;
      let sourceIndex = 0;
      let destination = 0;
      for (const glyph of glyphs) {
        for (const point of glyph.points) {
          if (destination < count && sourceIndex === Math.floor(destination * total / count)) {
            const offset = destination++ * 4;
            data[offset] = point[0];
            data[offset + 1] = point[1];
            data[offset + 2] = glyph.startedAt / 1000;
            data[offset + 3] = glyph.expiresAt / 1000;
          }
          sourceIndex++;
        }
      }
      this.settledTexture.needsUpdate = true;
    }

    setSettledProgress(now, dissolveProgress) {
      this.particleUniforms.uSettledTime.value = now / 1000;
      this.particleUniforms.uDissolveProgress.value = dissolveProgress;
    }

    clearSettled(returnToOrbit) {
      const uniforms = this.particleUniforms;
      uniforms.uSettledCount.value = 0;
      uniforms.uDissolveProgress.value = -1;
      if (returnToOrbit) {
        this.answerFocus = this.answerFocusTarget = 0;
        uniforms.uAnswerFocus.value = 0;
      }
    }

    step(timeSeconds, hz, camera, fluidVelocity, fluidDensity) {
      camera.updateMatrixWorld(true);
      this.group.updateWorldMatrix(true, false);

      this.compute.uPosition.value = this.current;
      this.compute.uVelocity.value = fluidVelocity || this.zero;
      this.compute.uDensity.value = fluidDensity || this.zero;
      this.compute.uViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.compute.uGroupWorld.value.copy(this.group.matrixWorld);
      this.compute.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
      this.compute.uTime.value = timeSeconds;
      this.compute.uHZ.value = hz;

      const target = this.targets[this.writeIndex];
      const renderer = this.renderer;
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.setRenderTarget(target);
        renderer.render(this.computeScene, this.computeCamera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = autoClear;
      }

      this.current = target.texture;
      this.writeIndex = 1 - this.writeIndex;
      this.particleUniforms.uPosition.value = this.current;
      this.particleUniforms.uTime.value = timeSeconds;
      const focusDelta = (this.answerFocusTarget - this.answerFocus) * Math.min(hz * 0.18, 1);
      this.answerFocus += focusDelta;
      this.particleUniforms.uAnswerFocus.value = this.answerFocus;
      if (this.glyphDuration || this.particleUniforms.uSettledCount.value) {
        this.particleUniforms.uFlowVelocity.value = this.compute.uVelocity.value;
        this.particleUniforms.uFlowDensity.value = this.compute.uDensity.value;
      }
      if (this.glyphDuration) {
        const progress = THREE.MathUtils.clamp((timeSeconds - this.glyphStarted) / this.glyphDuration, 0, 1);
        this.particleUniforms.uGlyphProgress.value = 1 - (1 - progress) ** 4;
      }
    }

    dispose() {
      this.group.removeFromParent();
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.quad.geometry.dispose();
      this.simulate.dispose();
      this.origin.dispose();
      this.randomTexture.dispose();
      this.zero.dispose();
      this.glyphTexture?.dispose();
      this.settledTexture?.dispose();
      this.matcap.dispose();
      for (const target of this.targets) target.dispose();
    }
  }

  window.AxonParticles = AxonParticles;
})();
