// Whiskers: thin strips that sway, bending more toward the tip. Drawn over the scene in art space.
// (Prepended at load: #version, precision.)

in vec2 aPos; // art units
in vec2 aNormal; // unit, across the whisker
in float aBend; // 0 at the root … 1 far from the snout: how much this point moves
in float aSide; // −1 or 1: which edge of the strip
in float aPhase; // per whisker, so neighbours move a little out of step
in float aWidth; // art units

uniform vec2 uResolution;
uniform vec2 uArtOrigin;
uniform float uArtScale;
uniform float uTime;
uniform float uWhisk; // twitch strength 0–1
uniform float uWind; // a gust passing 0–1

out float vAcross; // px from the centre line
out float vHalf; // half width, px
out float vBend;

const float TAU = 6.2831853;

void main() {
  float b = aBend;
  // Slow drift, a gust now and then, and fast whisking (rats sweep their whiskers 5–12 times a second).
  float drift = sin(uTime * 0.7 + aPhase) * 0.6 + sin(uTime * 1.9 + aPhase * 1.7) * 0.3;
  float gust = sin(uTime * 3.1 + aPhase) * uWind;
  float whisk = sin(uTime * TAU * 5.0 + aPhase * 0.3) * uWhisk;
  float offset = b * b * (drift * 3.0 + gust * 9.0) + pow(b, 1.5) * whisk * 10.0;
  vec2 p = aPos + aNormal * offset;

  float halfPx = max(aWidth * uArtScale * 0.5, 0.3);
  float reach = halfPx + 1.0; // one extra px for a soft edge
  vec2 s = uArtOrigin + p * uArtScale + aNormal * aSide * reach;
  gl_Position = vec4(s.x / uResolution.x * 2.0 - 1.0, 1.0 - s.y / uResolution.y * 2.0, 0.0, 1.0);
  vAcross = aSide * reach;
  vHalf = halfPx;
  vBend = b;
}
