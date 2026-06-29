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
      throw new BookletError('Doğrusal bağımlı noktalar nedeniyle matris çözülemedi.');
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
    throw new BookletError('Perspektif dönüşümü için tam olarak 4 köşe noktası gereklidir.');
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
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(new Error('Görsel yüklenemedi: ' + String(e)));
    img.src = imgUrl;
  });
  URL.revokeObjectURL(imgUrl);

  const srcWidth = img.naturalWidth;
  const srcHeight = img.naturalHeight;

  // 2. Create target A4 canvas and WebGL context
  const canvas = document.createElement('canvas');
  canvas.width = destWidth;
  canvas.height = destHeight;

  const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) {
    throw new BookletError('Cihazınız WebGL grafik hızlandırmasını desteklemiyor.');
  }

  try {
    // 3. Compile Shaders and link program
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    const program = gl.createProgram();
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
    const positionBuffer = gl.createBuffer();
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
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); // Do not flip texture Y axis to match HTML-style Y coordinates

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

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

    // Clean up WebGL resources
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

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
    const msg = error instanceof Error ? error.message : String(error);
    throw new BookletError(`Perspektif dönüşüm hatası: ${msg}`);
  }
}
