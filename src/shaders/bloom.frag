// Bloom: mode 0 keeps only the bright parts (at lower resolution); mode 1 blurs in one direction.
// (Prepended at load: #version, precision.)

uniform sampler2D uSource;
uniform vec2 uSourceTexel; // 1 / source size
uniform vec2 uTargetSize;
uniform int uMode;
uniform vec2 uDirection; // blur direction, in source texels
uniform float uThreshold;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uTargetSize;

  if (uMode == 0) {
    vec2 o = uSourceTexel;
    vec3 c = (texture(uSource, uv + vec2(-o.x, -o.y)).rgb + texture(uSource, uv + vec2(o.x, -o.y)).rgb
      + texture(uSource, uv + vec2(-o.x, o.y)).rgb + texture(uSource, uv + vec2(o.x, o.y)).rgb) * 0.25;
    float bright = max(c.r, max(c.g, c.b));
    float keep = max(bright - uThreshold, 0.0) / max(bright, 1e-4);
    outColor = vec4(c * keep, 1.0);
    return;
  }

  // 9-tap Gaussian using linear filtering (5 fetches).
  vec2 step1 = uDirection * uSourceTexel * 1.3846153846;
  vec2 step2 = uDirection * uSourceTexel * 3.2307692308;
  vec3 c = texture(uSource, uv).rgb * 0.2270270270;
  c += (texture(uSource, uv + step1).rgb + texture(uSource, uv - step1).rgb) * 0.3162162162;
  c += (texture(uSource, uv + step2).rgb + texture(uSource, uv - step2).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}
