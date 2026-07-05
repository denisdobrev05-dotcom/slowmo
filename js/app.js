import { buildFfmpegArgs } from './ffmpeg-commands.js';

// Pinned CDN versions (loaded lazily, only once the user hits "Обработи").
// @ffmpeg/core-mt needs cross-origin isolation (SharedArrayBuffer); when
// that isn't available we fall back to the single-threaded @ffmpeg/core.
const FFMPEG_VERSION = '0.12.15';
const UTIL_VERSION = '0.12.2';
const CORE_MT_VERSION = '0.12.10';
const CORE_VERSION = '0.12.10';

const FFMPEG_ESM_URL = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`;
const UTIL_ESM_URL = `https://unpkg.com/@ffmpeg/util@${UTIL_VERSION}/dist/esm/index.js`;
const CORE_MT_BASE_URL = `https://unpkg.com/@ffmpeg/core-mt@${CORE_MT_VERSION}/dist/esm`;
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

const MAX_RECOMMENDED_DURATION_SEC = 15;
const MAX_RECOMMENDED_DIMENSION = 1280;
const MAX_RECOMMENDED_FILE_BYTES = 200 * 1024 * 1024;

// ---- DOM refs ----
const installBtn = document.getElementById('install-btn');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const sourceInfo = document.getElementById('source-info');
const sourcePreview = document.getElementById('source-preview');
const metaName = document.getElementById('meta-name');
const metaDuration = document.getElementById('meta-duration');
const metaResolution = document.getElementById('meta-resolution');
const sourceWarningEl = document.getElementById('source-warning');

const stepSettings = document.getElementById('step-settings');
const stepProcess = document.getElementById('step-process');
const factorSelect = document.getElementById('factor-select');
const fpsSelect = document.getElementById('fps-select');
const downscaleCheck = document.getElementById('downscale-check');

const processBtn = document.getElementById('process-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const progressStatus = document.getElementById('progress-status');
const processErrorEl = document.getElementById('process-error');

const stepResult = document.getElementById('step-result');
const resultVideo = document.getElementById('result-video');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');

const isolationStatusEl = document.getElementById('isolation-status');

// ---- state ----
let selectedFile = null;
let sourceObjectUrl = null;
let resultObjectUrl = null;

// ---- install prompt (nice-to-have, PWA is installable regardless) ----
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  installBtn.hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});
window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
});

// ---- isolation status ----
function renderIsolationStatus() {
  isolationStatusEl.textContent = self.crossOriginIsolated
    ? 'Многонишкова обработка е активна (по-бърза).'
    : 'Работи в еднонишков режим (по-бавно) — презареди страницата, ако това е първото зареждане.';
}
renderIsolationStatus();

// ---- banners ----
function showBanner(el, message) {
  el.textContent = message;
  el.hidden = false;
}
function hideBanner(el) {
  el.hidden = true;
  el.textContent = '';
}

// ---- file selection ----
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    showBanner(sourceWarningEl, 'Файлът не изглежда да е видео. Опитай с друг файл.');
    return;
  }

  selectedFile = file;
  hideResult();
  hideBanner(sourceWarningEl);
  hideBanner(processErrorEl);

  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = URL.createObjectURL(file);
  sourcePreview.src = sourceObjectUrl;
  sourceInfo.hidden = false;
  metaName.textContent = file.name;
  metaDuration.textContent = '…';
  metaResolution.textContent = '…';

  sourcePreview.onloadedmetadata = () => {
    const duration = sourcePreview.duration;
    const width = sourcePreview.videoWidth;
    const height = sourcePreview.videoHeight;
    metaDuration.textContent = formatDuration(duration);
    metaResolution.textContent = `${width}×${height}`;
    checkSourceWarnings({ duration, width, height, size: file.size });
  };

  stepSettings.hidden = false;
  stepProcess.hidden = false;
  processBtn.disabled = false;
}

function checkSourceWarnings({ duration, width, height, size }) {
  const warnings = [];
  if (Number.isFinite(duration) && duration > MAX_RECOMMENDED_DURATION_SEC) {
    warnings.push(
      `Клипът е ${formatDuration(duration)} — по-дълъг от препоръчителните ~${MAX_RECOMMENDED_DURATION_SEC}с. Плавната интерполация е тежка за процесора; за по-дълги клипове очаквай по-бавна обработка или обмисли по-кратък откъс.`
    );
  }
  if (Math.max(width, height) > MAX_RECOMMENDED_DIMENSION) {
    warnings.push('Видеото е с резолюция над 720p — включи "Свали до 720p" за по-бърза и по-сигурна обработка.');
  }
  if (size > MAX_RECOMMENDED_FILE_BYTES) {
    warnings.push('Файлът е доста голям спрямо ограничението на паметта в браузъра — обработката може да се провали. Пробвай по-кратък клип.');
  }
  if (warnings.length) showBanner(sourceWarningEl, warnings.join(' '));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function hideResult() {
  stepResult.hidden = true;
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }
  resultVideo.removeAttribute('src');
  progressWrap.hidden = true;
  progressBar.classList.remove('indeterminate');
  progressBar.style.width = '0%';
}

// ---- ffmpeg loading (lazy - only on first "Обработи" click) ----
async function loadFFmpeg(onStatus) {
  const { FFmpeg } = await import(FFMPEG_ESM_URL);
  const { toBlobURL } = await import(UTIL_ESM_URL);
  const ffmpeg = new FFmpeg();

  async function loadCore(baseUrl, multiThread) {
    const config = {
      coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
    };
    if (multiThread) {
      config.workerURL = await toBlobURL(`${baseUrl}/ffmpeg-core.worker.js`, 'text/javascript');
    }
    await ffmpeg.load(config);
  }

  if (self.crossOriginIsolated) {
    try {
      onStatus('Зареждане на многонишково FFmpeg ядро…');
      await loadCore(CORE_MT_BASE_URL, true);
      return { ffmpeg, multiThread: true };
    } catch (err) {
      console.warn('Multi-thread FFmpeg core failed, falling back to single-thread.', err);
      onStatus('Многонишковото ядро не се зареди — превключвам на еднонишково (по-бавно)…');
    }
  }

  onStatus('Зареждане на FFmpeg ядро (еднонишково)…');
  await loadCore(CORE_BASE_URL, false);
  return { ffmpeg, multiThread: false };
}

function describeError(err) {
  const message = String(err?.message || err || '');
  if (/memory|oom|out of memory|allocation/i.test(message)) {
    return 'Видеото е твърде голямо за наличната памет на браузъра. Пробвай по-кратък клип или включи "Свали до 720p".';
  }
  if (/fetch|network|load/i.test(message)) {
    return 'Неуспешно зареждане на FFmpeg (нужна е интернет връзка при първо използване). Провери връзката и опитай пак.';
  }
  return 'Възникна грешка при обработката на видеото. Пробвай по-кратък клип или друг режим.';
}

function setIndeterminate(on) {
  progressBar.classList.toggle('indeterminate', on);
  if (on) progressBar.style.width = '';
}

// ---- process ----
processBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  processBtn.disabled = true;
  hideBanner(processErrorEl);
  stepResult.hidden = true;
  progressWrap.hidden = false;
  progressBar.style.width = '0%';
  setIndeterminate(true);
  progressStatus.textContent = 'Подготовка…';

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const factor = Number(factorSelect.value);
  const outputFps = Number(fpsSelect.value);
  const downscale = downscaleCheck.checked;

  let ffmpeg = null;
  try {
    const loaded = await loadFFmpeg((msg) => {
      progressStatus.textContent = msg;
    });
    ffmpeg = loaded.ffmpeg;

    ffmpeg.on('progress', ({ progress }) => {
      if (!Number.isFinite(progress)) return;
      const pct = Math.max(0, Math.min(1, progress));
      setIndeterminate(false);
      progressBar.style.width = `${Math.round(pct * 100)}%`;
      progressStatus.textContent = `Обработка… ${Math.round(pct * 100)}%`;
    });

    const { fetchFile } = await import(UTIL_ESM_URL);

    const ext = (selectedFile.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    progressStatus.textContent = 'Зареждане на видеото в паметта…';
    await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));

    const args = buildFfmpegArgs({ inputName, outputName, mode, factor, outputFps, downscale });
    progressStatus.textContent = mode === 'smooth' ? 'Интерполиране на нови кадри…' : 'Смесване на кадри…';
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = URL.createObjectURL(blob);
    resultVideo.src = resultObjectUrl;
    downloadBtn.href = resultObjectUrl;
    downloadBtn.download = `slowmo-${factor}x.mp4`;

    progressBar.style.width = '100%';
    progressStatus.textContent = 'Готово!';
    stepResult.hidden = false;
    stepResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setIndeterminate(false);
    showBanner(processErrorEl, describeError(err));
  } finally {
    if (ffmpeg) {
      try {
        ffmpeg.terminate();
      } catch (_) {
        /* already terminated */
      }
    }
    processBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  hideResult();
});
