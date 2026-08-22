import { BookletError } from './types';

export interface Point {
  x: number;
  y: number;
}

/**
 * Solves a system of 8 linear equations with 8 unknowns using Gaussian elimination.
 * M is an 8x8 matrix, v is an 8-component vector.
 * Returns the 8 coefficients of the homography matrix.
 */
function solve8x8(M: number[][], v: number[]): number[] {
  const n = 8;
  // Augment matrix M with vector v
  const mat: number[][] = [];
  for (let i = 0; i < n; i++) {
    mat.push([...M[i], v[i]]);
  }

  // Gaussian elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot row
    let maxRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(mat[r][i]) > Math.abs(mat[maxRow][i])) {
        maxRow = r;
      }
    }

    // Swap rows i and maxRow
    const temp = mat[i];
    mat[i] = mat[maxRow];
    mat[maxRow] = temp;

    const pivot = mat[i][i];
    if (Math.abs(pivot) < 1e-8) {
      throw new BookletError(
        'PERSPECTIVE_SINGULAR_MATRIX',
        undefined,
        'Could not solve the transform matrix due to collinear points.',
      );
    }

    // Eliminate below and above (reduced row echelon form)
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = mat[r][i] / pivot;
      for (let c = i; c <= n; c++) {
        mat[r][c] -= factor * mat[i][c];
      }
    }

    // Scale row i
    for (let c = i; c <= n; c++) {
      mat[i][c] /= pivot;
    }
  }

  // The last column contains the solution vector
  return mat.map((row) => row[n]);
}

/**
 * Calculates the 3x3 Homography Matrix that maps source points to destination points.
 * Returns a 9-component array representing a 3x3 matrix in row-major order.
 */
export function getHomographyMatrix(src: Point[], dst: Point[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new BookletError(
      'PERSPECTIVE_NEED_4_CORNERS',
      undefined,
      'Exactly 4 corner points are required for the perspective transform.',
    );
  }

  const M: number[][] = [];
  const v: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];

    M.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    v.push(dx);

    M.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    v.push(dy);
  }

  const h = solve8x8(M, v);
  // Add h88 = 1 as the 9th element of the homography matrix
  return [...h, 1.0];
}



const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    // Convert clip space position [-1, 1] to normalized texture coordinates [0, 1]
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform mat3 u_homography;
  uniform vec2 u_destSize;
  uniform vec2 u_srcSize;
  varying vec2 v_texCoord;
  void main() {
    // Map WebGL y-coordinate (0=bottom, 1=top) to A4 layout pixel coordinate (0=top, destHeight=bottom)
    vec3 destCoord = vec3(v_texCoord.x * u_destSize.x, (1.0 - v_texCoord.y) * u_destSize.y, 1.0);
    vec3 srcCoord = u_homography * destCoord;
    vec2 uv = srcCoord.xy / srcCoord.z;
    
    // Normalize coordinates for WebGL texture lookup
    vec2 texCoord = uv / u_srcSize;
    
    // Check if texture coordinate falls inside the bounds of the original image
    if (texCoord.x >= 0.0 && texCoord.x <= 1.0 && texCoord.y >= 0.0 && texCoord.y <= 1.0) {
      gl_FragColor = texture2D(u_image, texCoord);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black background for out of bounds
    }
  }
`;

/**
 * Creates and compiles a shader.
 */
function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Shader oluşturulamadı.');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader derlenemedi: ${log}`);
  }
  return shader;
}

/**
 * Warps the input image based on the selected 4 corners using WebGL.
 * Outputs a new image bytes array (JPEG format) representing a flat A4 page.
 * @param imgBytes Source image file bytes
 * @param corners Selected coordinates in pixel dimensions of the source image
 * @param destWidth Output A4 width in pixels
 * @param destHeight Output A4 height in pixels
 */
export async function warpPerspective(
  imgBytes: Uint8Array,
  corners: Point[],
  destWidth = 1240,
  destHeight = 1754
): Promise<Uint8Array> {
  // 1. Load image bytes into an HTMLImageElement
  const blob = new Blob([imgBytes as any]);
  const imgUrl = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error('Görsel yüklenemedi: ' + String(e)));
      img.src = imgUrl;
    });
  } finally {
    URL.revokeObjectURL(imgUrl);
  }

  const srcWidth = img.naturalWidth;
  const srcHeight = img.naturalHeight;

  // 2. Create target A4 canvas and WebGL context
  const canvas = document.createElement('canvas');
  canvas.width = destWidth;
  canvas.height = destHeight;

  const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) {
    throw new BookletError(
      'PERSPECTIVE_NO_WEBGL',
      undefined,
      'Your device does not support WebGL graphics acceleration.',
    );
  }

  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let positionBuffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;

  try {
    // 3. Compile Shaders and link program
    vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    program = gl.createProgram();
    if (!program) throw new Error('WebGL programı oluşturulamadı.');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL programı bağlanamadı: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    // 4. Setup geometry (fullscreen quad)
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
        -1.0,  1.0,
         1.0, -1.0,
         1.0,  1.0,
      ]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // 5. Setup Texture
    //
    // A phone camera routinely produces images larger than a low-end device's
    // MAX_TEXTURE_SIZE (2048 on older Android, vs 4000x3000 for a 12MP shot).
    // texImage2D fails silently in that case: the shader samples an incomplete
    // texture and the user gets a fully black page with no error at all. So
    // downscale into an intermediate 2D canvas whenever the source exceeds the
    // limit, preserving aspect ratio.
    //
    // This is transparent to the shader and must stay that way: the fragment
    // shader normalises with `uv / u_srcSize`, where `uv` is in ORIGINAL image
    // pixel coordinates (the homography maps dest -> src using the user's
    // `corners`, which are themselves in original-image pixels). Texture
    // sampling is in normalised [0,1] space regardless of the texture's actual
    // pixel dimensions, so u_srcSize MUST keep the original srcWidth/srcHeight
    // below — do not "fix" it to match the downscaled canvas.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let texSource: TexImageSource = img;
    if (srcWidth > maxTextureSize || srcHeight > maxTextureSize) {
      const fit = maxTextureSize / Math.max(srcWidth, srcHeight);
      const scaled = document.createElement('canvas');
      scaled.width = Math.max(1, Math.floor(srcWidth * fit));
      scaled.height = Math.max(1, Math.floor(srcHeight * fit));
      const scaledCtx = scaled.getContext('2d');
      if (!scaledCtx) {
        throw new BookletError(
          'PERSPECTIVE_CANVAS_CONTEXT_FAILED',
          undefined,
          'Could not scale the image: failed to get 2D canvas context.',
        );
      }
      scaledCtx.drawImage(img, 0, 0, scaled.width, scaled.height);
      texSource = scaled;
    }

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); // Do not flip texture Y axis to match HTML-style Y coordinates

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texSource);

    // texImage2D reports failure only through the error queue. Without this the
    // upload can fail and rendering carries on against an incomplete texture,
    // producing a black page that looks like a successful conversion.
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) {
      throw new BookletError(
        'PERSPECTIVE_GPU_UPLOAD_FAILED',
        { code: uploadError },
        `Could not upload the image to the GPU (WebGL error code: ${uploadError}).`,
      );
    }

    // 6. Calculate Homography Matrix
    // Target corners correspond to standard rectangular A4 corners (in top-left starting order)
    const destCorners: Point[] = [
      { x: 0, y: 0 },                  // Top-Left
      { x: destWidth, y: 0 },          // Top-Right
      { x: 0, y: destHeight },         // Bottom-Left
      { x: destWidth, y: destHeight }, // Bottom-Right
    ];

    // Source corners from user must follow the same order: Top-Left, Top-Right, Bottom-Left, Bottom-Right
    const homography = getHomographyMatrix(destCorners, corners);
    // Transpose row-major homography matrix to column-major order for WebGL 1.0 uniformMatrix3fv
    const colMajorHomography = [
      homography[0], homography[3], homography[6],
      homography[1], homography[4], homography[7],
      homography[2], homography[5], homography[8]
    ];

    // 7. Pass uniforms
    const uHomography = gl.getUniformLocation(program, 'u_homography');
    const uDestSize = gl.getUniformLocation(program, 'u_destSize');
    const uSrcSize = gl.getUniformLocation(program, 'u_srcSize');

    gl.uniformMatrix3fv(uHomography, false, new Float32Array(colMajorHomography));
    gl.uniform2f(uDestSize, destWidth, destHeight);
    gl.uniform2f(uSrcSize, srcWidth, srcHeight);

    // 8. Render
    gl.viewport(0, 0, destWidth, destHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 9. Convert Canvas to raw byte array (JPEG format at 90% quality)
    return await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(
        async (resBlob) => {
          if (!resBlob) {
            reject(new Error('Kırpılan görsel verisi oluşturulamadı.'));
            return;
          }
          const buf = await resBlob.arrayBuffer();
          resolve(new Uint8Array(buf));
        },
        'image/jpeg',
        0.9
      );
    });
  } catch (error) {
    if (error instanceof BookletError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new BookletError(
      'PERSPECTIVE_TRANSFORM_FAILED',
      { message: msg },
      `Perspective transform error: ${msg}`,
    );
  } finally {
    if (texture) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(texture);
    }
    if (positionBuffer) {
      gl.deleteBuffer(positionBuffer);
    }
    if (program) {
      gl.deleteProgram(program);
    }
    if (vs) {
      gl.deleteShader(vs);
    }
    if (fs) {
      gl.deleteShader(fs);
    }
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) {
      loseContext.loseContext();
    }
  }
}
