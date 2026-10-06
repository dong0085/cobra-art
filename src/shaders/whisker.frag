// Whisker colour: lit by the room and the key light, fading toward the tip.
// (Prepended at load: #version, precision.)

in float vAcross;
in float vHalf;
in float vBend;

uniform vec3 uColor;
uniform vec3 uKey;
uniform vec3 uRim;
uniform vec3 uAmbient;

out vec4 outColor;

void main() {
  // Coverage of a line vHalf px either side of the centre (thinner than a pixel: fainter instead).
  float cover = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * min(vHalf * 2.0, 1.0);
  vec3 col = uColor * (uAmbient * 2.0 + uKey * 0.9 + uRim * 0.5);
  outColor = vec4(col, cover * mix(0.95, 0.35, vBend));
}
