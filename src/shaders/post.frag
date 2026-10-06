// Final pass: soft glow, tone mapping, vignette, film grain.
// (Prepended at load: #version, precision, common.glsl.)

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uGrain;
uniform float uVignette;
uniform int uRaw; // 1: debug views, skip the look

out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 col = texture(uScene, uv).rgb;
  if (uRaw == 1) {
    outColor = vec4(linearToSrgb(col), 1.0);
    return;
  }

  col += texture(uBloom, uv).rgb * uBloomStrength;
  col = aces(col * uExposure);

  vec2 q = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  col *= mix(1.0, smoothstep(1.2, 0.2, length(q)), uVignette);

  vec3 srgb = linearToSrgb(col);
  srgb += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * uGrain * 0.04;
  outColor = vec4(srgb, 1.0);
}
