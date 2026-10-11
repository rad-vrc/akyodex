/** A capability hint for decorative effects, not access to browser settings. */
export function needsReducedEffects(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  let gl: WebGLRenderingContext | null = null;
  try {
    const canvas = createCanvas();
    canvas.width = canvas.height = 1;
    gl = canvas.getContext('webgl', {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl || gl.isContextLost()) return true;

    // Some browsers still allow an explicitly enabled software WebGL fallback.
    // Inspect it locally only: no renderer names are stored or sent as telemetry.
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    return typeof renderer === 'string'
      && /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver/i.test(renderer);
  } catch {
    return true;
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Cleanup is best effort and must not change the capability result.
    }
  }
}
