// Scene pass: a dark studio with a mottled backdrop, and the cobra as a lit sculpture, in linear HDR colour.
// (Prepended at load: #version, precision, common.glsl.)

uniform vec2 uResolution; // render size, px
uniform vec2 uArtOrigin; // where art (0, 0) lands, px from top-left
uniform float uArtScale; // px per art unit
uniform vec2 uArtSize; // 1024 × 1536
uniform float uBakeScale; // texture px per art unit
uniform float uDistanceLevels;
uniform float uSilhouetteLevels;
uniform float uTime;
uniform int uView; // 0 final, 1 ids, 2 distance, 3 kinds, 4 flow, 5 normals, 6 height

uniform sampler2D uIds;
uniform sampler2D uInk;
uniform sampler2D uDistance;
uniform sampler2D uSilhouette;
uniform highp sampler2D uRegions;

// Mood (linear colours)
uniform vec3 uBackDark;
uniform vec3 uBackLight;
uniform vec3 uKey;
uniform vec3 uRim;
uniform vec3 uAmbient;
uniform vec3 uScale;
uniform vec3 uBand;
uniform float uBandAmount;
uniform vec3 uBelly;
uniform vec3 uCavity;
uniform vec3 uIris;
uniform float uMetal;
uniform float uRoughness;
uniform float uWrap;

// Director
uniform vec3 uKeyDir;
uniform vec3 uRimDir;
uniform vec4 uRipple; // origin xy (art), radius, front width
uniform float uRippleStrength;
uniform vec3 uSweep; // bar position (reflection x), width, strength
uniform vec3 uShade; // shadow band position (art units), width, strength
uniform float uEyeGlint;
uniform float uDust;

// Layout, px from top-left
uniform vec2 uSpot; // centre of the spotlight on the backdrop
uniform float uSpotRadius;

// Tuning
uniform float uBevel; // art units
uniform float uRelief;
uniform float uSpecular;
uniform float uMetalBias;
uniform float uShadows;
uniform float uSpotAmount;
uniform float uDustAmount;

out vec4 outColor;

const int SCALE = 0;
const int VENTRAL = 1;
const int HEAD = 2;
const int EYE = 3;
const int NOSTRIL = 4;
const vec2 EYE_CENTER = vec2(706.0, 205.0);
const float FORM_RADIUS = 46.0; // art units: how wide each body part's rounded edge is
const float KEY_POWER = 2.6;
const float RIM_POWER = 2.0;
const vec2 KEY_POOL = vec2(660.0, 260.0); // the key light is aimed at the head

// ---------- Lookups ----------

bool inArt(vec2 p) {
  return all(greaterThanEqual(p, vec2(0.0))) && all(lessThan(p, uArtSize));
}

int blockAt(vec2 p) {
  if (!inArt(p)) return 0;
  vec4 c = texelFetch(uIds, ivec2(p * uBakeScale), 0);
  return int(c.r * 255.0 + 0.5) + int(c.g * 255.0 + 0.5) * 256;
}

vec4 region(int id, int row) {
  return texelFetch(uRegions, ivec2(id, row), 0);
}

/** Art units. Inside: distance to the edge of this body part. Outside: minus the distance to the snake. */
float formDistance(vec2 p) {
  if (!inArt(p)) return -64.0;
  return (texture(uSilhouette, p / uArtSize).r * 255.0 - 128.0) / uSilhouetteLevels / uBakeScale;
}

/** Art units from the nearest block edge. */
float blockDistance(vec2 p) {
  return texture(uDistance, p / uArtSize).r * 255.0 / uDistanceLevels / uBakeScale;
}

// ---------- Shape: height of the surface, in art units ----------

/** How strongly the passing ripple lifts the scale centred here (0–1). */
float rippleAt(vec2 center) {
  float d = distance(center, uRipple.xy);
  return exp(-pow((d - uRipple.z) / uRipple.w, 2.0)) * uRippleStrength;
}

float heightAt(vec2 p) {
  int id = blockAt(p);
  if (id == 0) return 0.0;
  float dist = blockDistance(p);
  float maxD = max(region(id, 1).x / uBakeScale, 0.5);

  // Each body part is a rounded column: steep at its edge, flat across the middle.
  float x = clamp(formDistance(p) / FORM_RADIUS, 0.0, 1.0);
  float form = sqrt(1.0 - (1.0 - x) * (1.0 - x)) * FORM_RADIUS * 0.75;

  // Each scale: a rounded bevel at its rim plus a gentle dome.
  float b = clamp(dist / uBevel, 0.0, 1.0);
  float bevel = (1.0 - (1.0 - b) * (1.0 - b)) * uBevel * 0.9;
  float bulge = clamp(dist / maxD, 0.0, 1.0);
  float dome = (1.0 - (1.0 - bulge) * (1.0 - bulge)) * min(maxD, 14.0) * 0.3;
  if (uRippleStrength > 0.0) dome *= 1.0 + 1.6 * rippleAt(region(id, 0).xy * uArtSize);

  float groove = texture(uInk, p / uArtSize).r * 1.5;
  return (form + bevel + dome) * uRelief - groove;
}

vec3 normalAt(vec2 p, float e) {
  float hx = heightAt(p + vec2(e, 0.0)) - heightAt(p - vec2(e, 0.0));
  float hy = heightAt(p + vec2(0.0, e)) - heightAt(p - vec2(0.0, e));
  return normalize(vec3(-hx, hy, 2.0 * e)); // art y points down; screen y points up
}

/** Soft shadow from the surface itself: march toward the light and look for higher ground. */
float selfShadow(vec2 p, float h0, vec3 L) {
  vec2 dir = normalize(vec2(L.x, -L.y) + 1e-5);
  float rise = L.z / max(length(L.xy), 1e-3); // height gained per art unit travelled
  float lit = 1.0;
  for (int i = 1; i <= 9; i++) {
    float d = float(i * i) * 0.9; // 0.9 … 73 art units, dense near the start
    float above = heightAt(p + dir * d) - (h0 + d * rise);
    lit = min(lit, clamp(1.0 - above / (0.6 + d * 0.12), 0.0, 1.0));
  }
  return lit;
}

/** How much key light reaches p (art units): a pool around the head, and the passing cloud. */
float keyShade(vec2 p) {
  float pool = mix(0.25, 1.0, exp(-pow(distance(p, KEY_POOL) / 760.0, 2.0)));
  float x = dot(p, normalize(vec2(1.0, 0.35)));
  return pool * (1.0 - 0.7 * uShade.z * exp(-pow((x - uShade.x) / uShade.y, 2.0)));
}

// ---------- Studio: what shiny surfaces reflect ----------

vec3 studio(vec3 r, float rough) {
  float soft = 0.04 + rough * 0.5;
  vec3 c = uAmbient * (0.2 + 0.4 * clamp(r.y * 0.5 + 0.5, 0.0, 1.0)); // a dim room, a little brighter above
  // The key softbox: a large soft panel of light.
  c += uKey * KEY_POWER * 1.6 * smoothstep(0.9 - soft, 0.92, dot(r, normalize(uKeyDir)));
  // A big dim fill panel beside the camera, so metal facing us has something to mirror.
  c += uKey * 0.45 * smoothstep(0.55 - soft, 0.95, dot(r, normalize(vec3(-0.25, 0.35, 1.0))));
  c += uKey * 0.12 * rough; // rough surfaces blur everything into a soft average
  // The rim strip light behind the snake.
  c += uRim * RIM_POWER * 1.4 * smoothstep(0.8 - soft, 0.86, dot(r, normalize(uRimDir)));
  // Sweep event: a light bar carried past the snake.
  c += uKey * 9.0 * uSweep.z * exp(-pow((r.x - uSweep.x) / (uSweep.y + rough * 0.3), 2.0)) * smoothstep(-0.4, 0.3, r.y);
  return c;
}

// ---------- Backdrop ----------

vec3 backdrop(vec2 s, vec2 p) {
  float H = uResolution.y;
  vec2 q = s / H;
  float drift = uTime * 0.006;
  // Painted canvas: big soft blotches, smaller clouds, fine tooth.
  float mottle = snoise(vec3(q * 1.4, drift)) * 0.55 + snoise(vec3(q * 3.8, drift * 1.7 + 5.0)) * 0.3
    + snoise(vec3(q * 14.0, 9.0)) * 0.08;
  float spot = 1.0 / pow(1.0 + pow(distance(s, uSpot) / uSpotRadius, 2.0), 2.0); // long soft tail, no visible edge
  float light = (0.1 + 0.75 * spot * uSpotAmount) * (1.0 + 0.55 * mottle) * keyShade(p);

  // The snake's shadow on the backdrop, thrown away from the key light.
  vec3 L = normalize(uKeyDir);
  vec2 offset = vec2(-L.x, L.y) * 70.0;
  float shadow = smoothstep(-40.0, 6.0, formDistance(p - offset)) * 0.7 * uShadows;
  light *= 1.0 - shadow;

  vec3 col = uBackDark * (1.0 + 0.4 * mottle) + uBackLight * max(light, 0.0);
  return col;
}

/** The faint cone of light from the key, in screen space (0–1). */
float beam(vec2 s) {
  float H = uResolution.y;
  vec3 L = normalize(uKeyDir);
  vec2 toLight = normalize(vec2(L.x, -L.y)); // on screen (y down)
  vec2 source = uSpot + toLight * H * 1.4; // off screen, upper left
  vec2 rel = s - source;
  float angle = acos(clamp(dot(normalize(rel), -toLight), -1.0, 1.0));
  return exp(-pow(angle / 0.3, 2.0)) * smoothstep(H * 2.6, H * 0.6, length(rel));
}

/** Dust motes drifting in the air: three layers, the nearest big and out of focus. */
float dust(vec2 s) {
  float H = uResolution.y;
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cell = H * (0.06 + fi * 0.05);
    float speed = 1.0 + uDust * 2.5;
    vec2 flow = vec2(0.010 + fi * 0.006, -0.006 - fi * 0.003) * uTime * speed * H;
    vec2 q = (s + flow) / cell;
    vec2 id = floor(q);
    vec2 h = hash22(id + fi * 17.0);
    vec2 sway = 0.12 * vec2(sin(uTime * 0.31 + h.x * 20.0), cos(uTime * 0.23 + h.y * 20.0));
    vec2 pos = id + 0.2 + h * 0.6 + sway;
    float radius = H * (0.0011 + fi * fi * 0.0016);
    float d = length((q - pos) * cell);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + h.x) + h.y * 30.0);
    float keep = step(0.45, hash12(id + fi * 3.1));
    sum += exp(-d * d / (radius * radius)) * keep * twinkle * (i == 2 ? 0.18 : 1.0);
  }
  return sum;
}

// ---------- The snake ----------

/** Physically based-ish GGX specular for one light. */
vec3 specular(vec3 n, vec3 L, vec3 V, vec3 f0, float rough) {
  vec3 H = normalize(L + V);
  float NoL = max(dot(n, L), 0.0);
  float NoV = max(dot(n, V), 1e-3);
  float NoH = max(dot(n, H), 0.0);
  float a = rough * rough;
  float a2 = a * a;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd);
  float k = a * 0.5;
  float vis = 0.25 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k));
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  return min(D * vis, 40.0) * F * NoL;
}

vec3 shadeSnake(int id, vec2 p) {
  vec4 r0 = region(id, 0);
  vec4 r1 = region(id, 1);
  int kind = int(r0.z + 0.5);
  vec2 center = r0.xy * uArtSize;
  float seed = r0.w;
  float ink = texture(uInk, p / uArtSize).r;

  // Colour: cross bands along the body, wobbly like the real snake's, nudged per scale.
  vec2 c = mix(center, p, 0.6); // mostly smooth, so bands run across scales
  float warp = snoise(vec3(c * 0.004, 3.1));
  float bands = smoothstep(0.6, 0.92, sin((c.y * 0.9 + c.x * 0.45) * 0.036 + warp * 1.6) * 0.5 + 0.5);
  vec3 base = mix(uScale, uBand, bands * uBandAmount) * (0.88 + 0.24 * seed);
  float metal = clamp(uMetal + uMetalBias, 0.0, 1.0);
  float rough = uRoughness * (0.85 + 0.3 * seed);
  vec3 emissive = vec3(0.0);
  float glint = 1.0;

  if (kind == VENTRAL) {
    base = uBelly * (0.9 + 0.1 * seed);
    rough *= 0.8;
  } else if (kind == HEAD) {
    base = mix(base, uBelly, 0.12);
  } else if (kind == EYE) {
    // Round pupil, iris fading darker toward the rim, a wet glassy surface.
    float r = distance(p, EYE_CENTER) / max(r1.x / uBakeScale, 1.0);
    base = mix(uIris * 1.3, uIris * 0.2, smoothstep(0.35, 0.95, r));
    base = mix(vec3(0.004), base, smoothstep(0.3, 0.38, r));
    metal = 0.0;
    rough = 0.05;
    glint = 1.0 + uEyeGlint * 5.0;
    emissive = uIris * uEyeGlint * 2.0 * smoothstep(0.3, 0.6, r) * (1.0 - smoothstep(0.8, 1.0, r));
  } else if (kind == NOSTRIL) {
    base = vec3(0.005);
    metal = 0.0;
  }
  rough = clamp(rough, 0.05, 1.0);

  float e = max(0.5, 0.6 / uArtScale);
  vec3 n = normalAt(p, e);
  float h0 = heightAt(p);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Lk = normalize(uKeyDir);
  vec3 Lr = normalize(uRimDir);
  vec3 f0 = mix(vec3(0.045), base, metal);

  // Shadows and occlusion: scale gaps, tucked-in body edges, and the body shading itself.
  float bd = blockDistance(p);
  float fd = formDistance(p);
  float ao = mix(0.4, 1.0, smoothstep(0.0, 3.5, bd)) * mix(0.5, 1.0, smoothstep(0.0, 28.0, fd));
  float lit = mix(1.0, selfShadow(p, h0, Lk), uShadows) * keyShade(p);

  // Diffuse, with "wrap" letting light soak around the form (jade, porcelain).
  float w = uWrap;
  float diffKey = max((dot(n, Lk) + w) / (1.0 + w), 0.0) / (1.0 + w);
  float diffRim = max(dot(n, Lr), 0.0);
  vec3 diffuse = base * (1.0 - metal) * (
    uKey * KEY_POWER * diffKey * lit
    + uRim * RIM_POWER * 0.5 * diffRim
    + uAmbient * (0.6 + 0.4 * n.y) * ao);

  vec3 spec = specular(n, Lk, V, f0, rough) * uKey * KEY_POWER * lit * glint
    + specular(n, Lr, V, f0, rough) * uRim * RIM_POWER;

  float NoV = max(n.z, 0.0);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0) * (1.0 - rough);
  vec3 reflection = studio(reflect(-V, n), rough) * fresnel * ao * mix(1.0, lit, 0.5);

  vec3 col = diffuse + (spec * uSpecular + reflection) * mix(1.0, ao, 0.6);
  // Translucent materials glow faintly at their edges when back-lit.
  col += base * uRim * uWrap * pow(1.0 - NoV, 2.0) * 0.6;

  // Deep in the gaps between scales: the cavity colour (verdigris on bronze, cobalt on porcelain).
  float cavity = clamp(ink * 0.8 + (1.0 - smoothstep(0.0, 2.0, bd)) * 0.35, 0.0, 1.0);
  vec3 cavityLit = uCavity * (uAmbient * 1.5 + uKey * 0.35 * lit);
  col = mix(col, cavityLit, cavity);

  return col + emissive;
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 p = (s - uArtOrigin) / uArtScale;
  int id = blockAt(p);
  float H = uResolution.y;

  // ----- Debug views -----
  if (uView != 0) {
    vec3 c = vec3(0.02);
    if (id != 0) {
      vec4 r0 = region(id, 0);
      vec4 r1 = region(id, 1);
      vec4 r2 = region(id, 2);
      int kind = int(r0.z + 0.5);
      if (uView == 1) c = hsv(hash11(float(id) * 1.618), 0.55, 0.9);
      if (uView == 2) c = vec3(clamp(blockDistance(p) / max(r1.x / uBakeScale, 0.5), 0.0, 1.0));
      if (uView == 3) {
        c = kind == SCALE ? vec3(0.42, 0.7, 0.79) : kind == VENTRAL ? vec3(0.95, 0.76, 0.31)
          : kind == HEAD ? vec3(0.88, 0.48, 0.37) : kind == EYE ? vec3(0.5, 0.7, 0.6) : vec3(0.6, 0.36, 0.9);
      }
      if (uView == 4) c = hsv(fract(r2.x / 3.14159265), 0.7, 0.4 + 0.6 * r2.y);
      if (uView == 5) c = normalAt(p, max(0.5, 0.6 / uArtScale)) * 0.5 + 0.5;
      if (uView == 6) c = vec3(heightAt(p) / 45.0);
      c = c * c; // the post pass converts back to sRGB
    }
    outColor = vec4(c, 1.0);
    return;
  }

  vec3 col = backdrop(s, p);
  float shaft = beam(s);
  col += uKey * 0.035 * shaft * uSpotAmount * keyShade(p);

  if (id != 0) {
    // The body cut off at the lower left sinks into the dark.
    float fade = mix(1.0, smoothstep(40.0, 460.0, p.x), smoothstep(900.0, 1250.0, p.y));
    col = mix(col, shadeSnake(id, p), fade);
  }

  // Dust in the air, lit mostly inside the light shaft.
  col += uKey * dust(s) * (0.15 + 1.4 * shaft) * (0.35 + 1.2 * uDust) * uDustAmount * 0.6;

  // The floor of the room falls into darkness.
  col *= mix(1.0, 0.35, smoothstep(H * 0.72, H * 1.05, s.y));

  outColor = vec4(col, 1.0);
}
