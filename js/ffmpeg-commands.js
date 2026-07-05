// Pure helpers for building the FFmpeg filter graph and argv. Kept separate
// from app.js so the "no naive slow-down" logic is easy to read in isolation.
//
// The core idea: slowing down a video by simply stretching timestamps
// (setpts) keeps the *original* frame count, so a 30fps clip slowed 2x only
// shows ~15 distinct frames per second of output - it looks jerky. To get a
// truly smooth result we first synthesize new in-between frames with motion
// interpolation (or, in "fast" mode, motion-blurred blended frames) up to
// `outputFps * factor`, and only then apply setpts to slow it down. Locking
// the final output to `-r outputFps` guarantees a clean, constant frame rate.

/**
 * @param {{mode: 'smooth'|'fast', factor: number, outputFps: number, downscale: boolean}} opts
 * @returns {string} a single -vf filter graph, safe to pass as one argv element (no shell quoting needed)
 */
export function buildFilterGraph({ mode, factor, outputFps, downscale }) {
  const parts = [];

  if (downscale) {
    // min(720\,ih) only scales *down*: if the source is already <= 720p tall,
    // the height expression evaluates to ih (a no-op), avoiding an upscale.
    // The comma inside min(...) must be escaped since commas separate
    // filters in the -vf chain.
    parts.push('scale=-2:min(720\\,ih):flags=lanczos');
  }

  if (mode === 'fast') {
    parts.push('tblend=all_mode=average');
  } else {
    const interpFps = outputFps * factor;
    parts.push(`minterpolate=mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${interpFps}`);
  }

  parts.push(`setpts=${factor.toFixed(1)}*PTS`);

  return parts.join(',');
}

/**
 * @param {{inputName: string, outputName: string, mode: 'smooth'|'fast', factor: number, outputFps: number, downscale: boolean}} opts
 * @returns {string[]} argv for ffmpeg.exec() - no shell involved, so no quoting needed
 */
export function buildFfmpegArgs({ inputName, outputName, mode, factor, outputFps, downscale }) {
  const filterGraph = buildFilterGraph({ mode, factor, outputFps, downscale });
  return [
    '-i', inputName,
    '-vf', filterGraph,
    '-r', String(outputFps),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-an',
    outputName,
  ];
}
