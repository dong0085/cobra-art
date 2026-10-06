// Small WebGL2 helpers.

export function createProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed:\n${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed:\n${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export type TextureSpec = {
  width: number;
  height: number;
  internalFormat: number; // e.g. gl.RGBA8, gl.R8, gl.RGBA32F
  format: number; // e.g. gl.RGBA, gl.RED
  type: number; // e.g. gl.UNSIGNED_BYTE, gl.FLOAT
  data: ArrayBufferView | null;
  smooth?: boolean; // linear filtering (only for filterable formats)
};

export function createTexture(gl: WebGL2RenderingContext, spec: TextureSpec): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, spec.internalFormat, spec.width, spec.height, 0, spec.format, spec.type, spec.data);
  const filter = spec.smooth ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** An off-screen colour target that later passes can sample (linear filtering). */
export type Target = { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, hdr: boolean): Target {
  const texture = createTexture(gl, {
    width,
    height,
    internalFormat: hdr ? gl.RGBA16F : gl.RGBA8,
    format: gl.RGBA,
    type: hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
    data: null,
    smooth: true,
  });
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target) {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

/** Uniform setters with cached locations; unknown names are ignored. */
export function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const cache = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name)!;
  };
  return {
    f(name: string, ...v: number[]) {
      const l = loc(name);
      if (!l) return;
      if (v.length === 1) gl.uniform1f(l, v[0]);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    },
    i(name: string, v: number) {
      const l = loc(name);
      if (l) gl.uniform1i(l, v);
    },
    v3(name: string, values: number[]) {
      const l = loc(name);
      if (l) gl.uniform3fv(l, values);
    },
  };
}
