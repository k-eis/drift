// ── Structural Drift エフェクトエンジン
// ルール:
// 01 輪郭は保持する → エッジ検出したシルエットは元のまま重ねて描画
// 02 内部の情報だけ水平に流す → 各水平ラインのピクセルを横方向に引き伸ばす
// 03 横方向のみ変形する → 縦方向の座標は変えない
// 04 一定間隔で正常ラインを残す → spacingごとに元のラインをそのまま残す
// 05 透明部分も変形対象 → アルファチャンネルも同様に処理
// 06 ランダムではなく機械的リズム → 決定論的な間隔・強度で処理

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const outputCanvas = document.getElementById('outputCanvas');
const canvasBadge = document.getElementById('canvasBadge');
const ctx = outputCanvas.getContext('2d');

const intensitySlider = document.getElementById('intensity');
const spacingSlider = document.getElementById('spacing');
const preserveSlider = document.getElementById('preserve');
const directionSelect = document.getElementById('direction');
const monochromeCheckbox = document.getElementById('monochrome');
const intensityVal = document.getElementById('intensityVal');
const spacingVal = document.getElementById('spacingVal');
const preserveVal = document.getElementById('preserveVal');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const presetBtns = document.querySelectorAll('.preset-btn');

let originalImage = null;
let originalImageData = null;

// ── ファイル読み込み
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      setupCanvas(img);
      applyDrift();
      dropZone.style.display = 'none';
      canvasBadge.style.display = 'block';
      outputCanvas.style.display = 'block';
      downloadBtn.disabled = false;
      resetBtn.disabled = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas(img) {
  // 最大幅を制限してパフォーマンスを確保
  const MAX_W = 1400;
  let w = img.width, h = img.height;
  if (w > MAX_W) {
    h = h * (MAX_W / w);
    w = MAX_W;
  }
  outputCanvas.width = w;
  outputCanvas.height = h;

  // オリジナルを一度描画してImageDataとして保持
  ctx.drawImage(img, 0, 0, w, h);
  originalImageData = ctx.getImageData(0, 0, w, h);
}

// ── コアエフェクト：Structural Drift
function applyDrift() {
  if (!originalImageData) return;

  const w = outputCanvas.width;
  const h = outputCanvas.height;

  const intensity = parseInt(intensitySlider.value) / 100; // 0.0 - 1.0
  const spacing = parseInt(spacingSlider.value);            // 保持ラインの間隔(px)
  const preserveRatio = parseInt(preserveSlider.value) / 100; // 保持ラインの割合
  const direction = directionSelect.value;
  const mono = monochromeCheckbox.checked;

  // 元データをコピー
  const src = originalImageData.data;
  const out = new Uint8ClampedArray(src.length);

  // Rule 06: 機械的リズム → 決定論的に「このラインは保持するか」を判定
  // spacingごとに、preserveRatioの割合で保持ラインを配置
  function isPreservedLine(y) {
    const cyclePos = y % spacing;
    const preserveCount = Math.max(1, Math.round(spacing * preserveRatio));
    return cyclePos < preserveCount;
  }

  // Rule 02+03: 各水平ラインを横方向にストレッチ
  // strengthはintensityに応じて、そのラインのピクセルをどれだけ「引き伸ばす」か
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4;

    if (isPreservedLine(y)) {
      // Rule 04: このラインはそのままコピー（正常ライン）
      for (let x = 0; x < w; x++) {
        const i = rowStart + x * 4;
        out[i] = src[i];
        out[i+1] = src[i+1];
        out[i+2] = src[i+2];
        out[i+3] = src[i+3]; // Rule 05: アルファも保持
      }
      continue;
    }

    // ドリフトライン：サンプリングした少数の点を横に引き伸ばす
    // intensityが高いほど、サンプリング元の点の数が少なくなる（＝より引き伸ばされる）
    const sampleCount = Math.max(1, Math.round(w * (1 - intensity * 0.97)));
    const step = w / sampleCount;

    for (let s = 0; s < sampleCount; s++) {
      const srcX = Math.min(w-1, Math.floor(s * step));
      const srcI = rowStart + srcX * 4;
      const r = src[srcI], g = src[srcI+1], b = src[srcI+2], a = src[srcI+3];

      // このサンプル点を次のサンプル点まで引き伸ばして埋める
      const spanStart = Math.floor(s * step);
      const spanEnd = Math.floor((s+1) * step);

      let fillStart = spanStart, fillEnd = spanEnd;
      if (direction === 'left') {
        // 左方向：このピクセルより左側に伸ばす
        fillStart = Math.max(0, spanStart - Math.floor(step));
        fillEnd = spanStart + 1;
      } else if (direction === 'both') {
        const half = Math.floor(step/2);
        fillStart = Math.max(0, srcX - half);
        fillEnd = Math.min(w, srcX + half + 1);
      }
      // 'right'はデフォルト（spanStart→spanEnd、そのまま右に伸びる）

      for (let x = fillStart; x < fillEnd && x < w; x++) {
        const i = rowStart + x * 4;
        out[i] = r; out[i+1] = g; out[i+2] = b; out[i+3] = a;
      }
    }
  }

  // モノクロ変換（オプション）
  if (mono) {
    for (let i = 0; i < out.length; i += 4) {
      const gray = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
      out[i] = out[i+1] = out[i+2] = gray;
    }
  }

  const resultData = new ImageData(out, w, h);
  ctx.putImageData(resultData, 0, 0);
}

// ── UIイベント
intensitySlider.addEventListener('input', () => {
  intensityVal.textContent = intensitySlider.value + '%';
  clearPresetActive();
  applyDrift();
});
spacingSlider.addEventListener('input', () => {
  spacingVal.textContent = spacingSlider.value + 'px';
  applyDrift();
});
preserveSlider.addEventListener('input', () => {
  preserveVal.textContent = preserveSlider.value + '%';
  applyDrift();
});
directionSelect.addEventListener('change', applyDrift);
monochromeCheckbox.addEventListener('change', applyDrift);

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.preset;
    intensitySlider.value = val;
    intensityVal.textContent = val + '%';
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyDrift();
  });
});

function clearPresetActive() {
  presetBtns.forEach(b => b.classList.remove('active'));
}

downloadBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'structural-drift.png';
  link.href = outputCanvas.toDataURL('image/png');
  link.click();
});

resetBtn.addEventListener('click', () => {
  originalImage = null;
  originalImageData = null;
  outputCanvas.style.display = 'none';
  canvasBadge.style.display = 'none';
  dropZone.style.display = 'flex';
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  fileInput.value = '';
});
