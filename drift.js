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
const timeSlider = document.getElementById('time');
const spacingSlider = document.getElementById('spacing');
const preserveSlider = document.getElementById('preserve');
const wobbleSlider = document.getElementById('wobble');
const gradationSlider = document.getElementById('gradation');
const directionSelect = document.getElementById('direction');
const monochromeCheckbox = document.getElementById('monochrome');
const intensityVal = document.getElementById('intensityVal');
const spacingVal = document.getElementById('spacingVal');
const preserveVal = document.getElementById('preserveVal');
const wobbleVal = document.getElementById('wobbleVal');
const gradationVal = document.getElementById('gradationVal');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const presetBtns = document.querySelectorAll('.profile-btn');
const timeVal = document.getElementById('timeVal');

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

// 1点から指定方向にフェードしながら伸びる細い線を描く
// out: 出力バッファ, rowStart: この行の開始インデックス
// srcX: 起点X, len: 伸ばす長さ, dir: 1=右 / -1=左
// r,g,b,a: 線の色, w: 画像幅, bgR/G/B: 背景色（フェード先）
// 決定論的な擬似ランダム（同じ入力なら常に同じ値）
// Rule 06「ランダムではなく機械的リズム」を守るため、乱数ではなくsin波ベースのハッシュを使う
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x); // 0-1の範囲
}

function drawFadingLine(out, rowStart, srcX, len, dir, r, g, b, a, w, bgR, bgG, bgB, decayExponent, tiltPerStep, h) {
  const steps = Math.min(len, w);
  const baseY = h ? Math.floor(rowStart / (w*4)) : null;
  for (let d = 0; d < steps; d++) {
    const x = srcX + d * dir;
    if (x < 0 || x >= w) break;

    // 減衰カーブ：起点は濃く、離れるほど背景色へフェード
    // 累乗カーブで「最初は濃いまま少し伸び、その後急速に薄れる」線らしい消え方に
    const progress = d / steps;
    const alpha = Math.pow(1 - progress, decayExponent || 1.8);

    // Wobble：橋の法則「微小な回転」→ 線がわずかに傾きながら伸びる
    let curRowStart = rowStart;
    if (tiltPerStep && h) {
      const tiltY = Math.round(baseY + d * tiltPerStep);
      if (tiltY < 0 || tiltY >= h) continue;
      curRowStart = tiltY * w * 4;
    }

    const i = curRowStart + x * 4;
    // 既存のピクセル（背景 or 他の線）とアルファブレンド
    // 複数の線が重なる場合は「濃い方」を優先（線が消えずに重なって見える）
    const existingLum = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
    const newLumBlend = (r*alpha + bgR*(1-alpha))*0.299 + (g*alpha+bgG*(1-alpha))*0.587 + (b*alpha+bgB*(1-alpha))*0.114;

    if (newLumBlend < existingLum || d === 0) {
      out[i]   = r*alpha + bgR*(1-alpha);
      out[i+1] = g*alpha + bgG*(1-alpha);
      out[i+2] = b*alpha + bgB*(1-alpha);
      out[i+3] = 255;
    }
  }
}

// 縦方向版：1点から上下にフェードしながら伸びる細い線を描く
// colStart: この列のピクセルインデックス基準, srcY: 起点Y, w: 画像幅(1ピクセルあたりのバイト数計算に必要)
function drawFadingLineVertical(out, x, srcY, len, dir, r, g, b, a, w, h, bgR, bgG, bgB, decayExponent) {
  const steps = Math.min(len, h);
  for (let d = 0; d < steps; d++) {
    const y = srcY + d * dir;
    if (y < 0 || y >= h) break;

    const progress = d / steps;
    const alpha = Math.pow(1 - progress, decayExponent || 1.8);

    const i = (y * w + x) * 4;
    const existingLum = out[i]*0.299 + out[i+1]*0.587 + out[i+2]*0.114;
    const newLumBlend = (r*alpha + bgR*(1-alpha))*0.299 + (g*alpha+bgG*(1-alpha))*0.587 + (b*alpha+bgB*(1-alpha))*0.114;

    if (newLumBlend < existingLum || d === 0) {
      out[i]   = r*alpha + bgR*(1-alpha);
      out[i+1] = g*alpha + bgG*(1-alpha);
      out[i+2] = b*alpha + bgB*(1-alpha);
      out[i+3] = 255;
    }
  }
}

// ── コアエフェクト：Structural Drift
function applyDrift() {
  if (!originalImageData) return;

  const w = outputCanvas.width;
  const h = outputCanvas.height;

  const intensity = parseInt(intensitySlider.value) / 100; // 0.0 - 1.0
  const timeMs = parseInt(timeSlider.value);                // 0-80ms：時間の翻訳
  const timeT = timeMs / 80;                                // 0.0 - 1.0
  const spacing = parseInt(spacingSlider.value);            // 保持ラインの間隔(px)
  const preserveRatio = parseInt(preserveSlider.value) / 100; // 保持ラインの割合
  const wobble = parseInt(wobbleSlider.value) / 100; // 0-1：秩序と揺らぎの度合い
  const gradation = parseInt(gradationSlider.value) / 100; // 0-1：輪郭より階調（境界のなだらかさ）
  const direction = directionSelect.value;
  const mono = monochromeCheckbox.checked;

  // 元データをコピー
  const src = originalImageData.data;
  const out = new Uint8ClampedArray(src.length);

  if (direction === 'converge') {
    // ── Converge：橋の法則「一点収束（ベクトル）」
    // 画面中心を消失点とし、各水平ラインのピクセルが中心へ向かって流れるように変形する
    const cx = w / 2;
    const cy = h / 2;

    function isPreservedLineConv(y) {
      const wobbleOffset = wobble > 0 ? (pseudoRandom(Math.floor(y/spacing)) - 0.5) * spacing * wobble * 0.8 : 0;
      const cyclePos = ((y + wobbleOffset) % spacing + spacing) % spacing;
      const preserveCount = Math.max(1, Math.round(spacing * preserveRatio));
      return cyclePos < preserveCount;
    }

    const bgR = 250, bgG = 250, bgB = 248;

    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;

      if (isPreservedLineConv(y)) {
        for (let x = 0; x < w; x++) {
          const i = rowStart + x * 4;
          out[i] = src[i]; out[i+1] = src[i+1]; out[i+2] = src[i+2]; out[i+3] = src[i+3];
        }
        continue;
      }

      for (let x = 0; x < w; x++) {
        const i = rowStart + x * 4;
        out[i] = bgR; out[i+1] = bgG; out[i+2] = bgB; out[i+3] = 255;
      }

      // このラインの中心からの距離に応じて収束の強さを変える
      // 中心に近いほど変化は少なく、外側ほど強く中心方向へ引き寄せられる
      const distFromCenter = Math.abs(y - cy) / cy; // 0(中心)-1(端)
      const t = intensity;
      const minSamples = 2;
      const logMax = Math.log(w);
      const logMin = Math.log(minSamples);
      const eased = Math.pow(t, 1.15);
      const sampleCount = Math.max(minSamples, Math.round(Math.exp(logMax - (logMax-logMin) * eased)));
      const step = w / sampleCount;

      const fadeLen = Math.max(6, step * (0.85 + t * 0.9) * (0.4 + timeT * 1.6) * (0.5 + distFromCenter * 0.8));
      const decayExponent = 3.2 - timeT * 2.4;

      for (let s = 0; s < sampleCount; s++) {
        const srcX = Math.min(w-1, Math.floor(s * step));
        const srcI = rowStart + srcX * 4;
        const r = src[srcI], g = src[srcI+1], b = src[srcI+2], a = src[srcI+3];

        // 収束方向：ピクセルが画面中心(cx)に向かう向き
        const dir = srcX < cx ? 1 : -1;

        // Wobble：収束線にも微小な傾きを
        const tiltPerStep = wobble > 0 ? (pseudoRandom(y*7+s*3+500) - 0.5) * wobble * 0.35 : 0;

        drawFadingLine(out, rowStart, srcX, fadeLen, dir, r, g, b, a, w, bgR, bgG, bgB, decayExponent, tiltPerStep, h);
      }
    }

  } else if (direction === 'vertical') {
    // ── Vertical：各垂直ラインを縦方向にストレッチ（Horizontalの90度回転版）
    function isPreservedCol(x) {
      const wobbleOffset = wobble > 0 ? (pseudoRandom(Math.floor(x/spacing)+1000) - 0.5) * spacing * wobble * 0.8 : 0;
      const cyclePos = ((x + wobbleOffset) % spacing + spacing) % spacing;
      const preserveCount = Math.max(1, Math.round(spacing * preserveRatio));
      return cyclePos < preserveCount;
    }

    for (let x = 0; x < w; x++) {
      if (isPreservedCol(x)) {
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 4;
          out[i] = src[i]; out[i+1] = src[i+1]; out[i+2] = src[i+2]; out[i+3] = src[i+3];
        }
        continue;
      }

      const minSamples = 2;
      const t = intensity;
      const logMax = Math.log(h);
      const logMin = Math.log(minSamples);
      const eased = Math.pow(t, 1.15);
      const sampleCount = Math.max(minSamples, Math.round(Math.exp(logMax - (logMax-logMin) * eased)));
      const step = h / sampleCount;

      const bgR = 250, bgG = 250, bgB = 248;
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        out[i] = bgR; out[i+1] = bgG; out[i+2] = bgB; out[i+3] = 255;
      }

      const fadeLen = Math.max(6, step * (0.85 + t * 0.9) * (0.4 + timeT * 1.6));
      const decayExponent = 3.2 - timeT * 2.4;

      for (let s = 0; s < sampleCount; s++) {
        const srcY = Math.min(h-1, Math.floor(s * step));
        const srcI = (srcY * w + x) * 4;
        const r = src[srcI], g = src[srcI+1], b = src[srcI+2], a = src[srcI+3];
        // Verticalは下方向に伸ばす（重力的な自然さ）
        drawFadingLineVertical(out, x, srcY, fadeLen, 1, r, g, b, a, w, h, bgR, bgG, bgB, decayExponent);
      }
    }

  } else {
  // Rule 06: 機械的リズム → 決定論的に「このラインは保持するか」を判定
  // spacingごとに、preserveRatioの割合で保持ラインを配置
  // Wobble: 橋の法則「秩序＋揺らぎ」→ 判定位置に微小なズレを加える（決定論的、ランダムではない）
  function isPreservedLine(y) {
    const wobbleOffset = wobble > 0 ? (pseudoRandom(Math.floor(y/spacing)) - 0.5) * spacing * wobble * 0.8 : 0;
    const cyclePos = ((y + wobbleOffset) % spacing + spacing) % spacing;
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
    // intensityが高いほど、サンプリング元の点の数が指数的に減る（＝一本の線が画面幅近くまで伸びる）
    // 0%→ほぼ元のまま、100%→数本の線が画面全体に伸びる極端な状態
    const minSamples = 2;                          // 100%到達時の最小サンプル数
    const t = intensity;                           // 0-1
    // 対数的スケール：sampleCountを"個数"ではなく指数で直接補間する
    // t=0 → w個(元解像度) / t=1 → minSamples個 まで滑らかに、かつ早めに効く
    const logMax = Math.log(w);
    const logMin = Math.log(minSamples);
    const eased = Math.pow(t, 1.15); // ほぼ線形〜やや早め
    const sampleCount = Math.max(minSamples, Math.round(Math.exp(logMax - (logMax-logMin) * eased)));
    const step = w / sampleCount;

    // 背景（白/ベース）を先に敷いておく：線の間の余白を作るため
    // 元画像の最も明るい色域に寄せた背景色を使う（自然な余白に見せる）
    const bgR = 250, bgG = 250, bgB = 248;
    for (let x = 0; x < w; x++) {
      const i = rowStart + x * 4;
      out[i] = bgR; out[i+1] = bgG; out[i+2] = bgB; out[i+3] = 255;
    }

    // フェード距離：intensityが高いほど、線が長く・薄く伸びる
    // stepが大きい（＝サンプルが疎ら）ほど、その間隔を線で埋め尽くすくらい長く伸ばす
    // フェード距離：「時間」を翻訳した長さ。TIMEが長いほど、線がより長い時間軸をかけて消える
    // INTENSITYはサンプル間引き（何が残るか）、TIMEは減衰の速さ（どれだけ長く尾を引くか）
    const fadeLen = Math.max(6, step * (0.85 + t * 0.9) * (0.4 + timeT * 1.6));

    for (let s = 0; s < sampleCount; s++) {
      const srcX = Math.min(w-1, Math.floor(s * step));
      const srcI = rowStart + srcX * 4;
      const r = src[srcI], g = src[srcI+1], b = src[srcI+2], a = src[srcI+3];

      // 暗すぎる/明るすぎる（背景に近い）ピクセルは線として弱める
      const luminance = (r*0.299 + g*0.587 + b*0.114) / 255;

      let dir = 1; // right
      if (direction === 'left') dir = -1;

      // TIMEが短い(0ms)ほど急に消え(exponent大)、長い(80ms)ほどゆっくり尾を引く(exponent小)
      const decayExponent = 3.2 - timeT * 2.4;

      // Wobble：線ごとに決定論的な微小傾きを持たせる（橋の法則「秩序＋微小な回転」）
      const tiltPerStep = wobble > 0 ? (pseudoRandom(y*7+s*3) - 0.5) * wobble * 0.35 : 0;

      if (direction === 'both') {
        drawFadingLine(out, rowStart, srcX, fadeLen, 1, r, g, b, a, w, bgR, bgG, bgB, decayExponent, tiltPerStep, h);
        drawFadingLine(out, rowStart, srcX, fadeLen, -1, r, g, b, a, w, bgR, bgG, bgB, decayExponent, tiltPerStep, h);
      } else {
        drawFadingLine(out, rowStart, srcX, fadeLen, dir, r, g, b, a, w, bgR, bgG, bgB, decayExponent, tiltPerStep, h);
      }
    }
  }
  } // end of else (horizontal branch)

  // Rule 02「輪郭よりも階調」+ Rule 04「消失が美しい」
  // 保持ライン(輪郭)とドリフトライン(消えていく部分)の境界を、なだらかな階調でつなぐ
  // gradation=0: 今までどおり境界がはっきり／gradation=100: 境界が滲むように溶け合う
  if (gradation > 0) {
    const blendRange = Math.max(1, Math.round(spacing * gradation * 1.5));

    if (direction === 'vertical') {
      // 列方向の距離を計算
      const preserveCount = Math.max(1, Math.round(spacing * preserveRatio));
      for (let x = 0; x < w; x++) {
        const cyclePos = x % spacing;
        const distToPreserve = cyclePos < preserveCount
          ? 0
          : Math.min(cyclePos - preserveCount, spacing - cyclePos);
        if (distToPreserve === 0 || distToPreserve > blendRange) continue;
        const blend = 1 - (distToPreserve / blendRange); // 境界に近いほど1に近い
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 4;
          out[i]   = out[i]   * (1-blend) + src[i]   * blend;
          out[i+1] = out[i+1] * (1-blend) + src[i+1] * blend;
          out[i+2] = out[i+2] * (1-blend) + src[i+2] * blend;
        }
      }
    } else if (direction !== 'converge') {
      // Horizontal / Left / Right / Both：行方向の距離を計算
      const preserveCount = Math.max(1, Math.round(spacing * preserveRatio));
      for (let y = 0; y < h; y++) {
        const cyclePos = y % spacing;
        const distToPreserve = cyclePos < preserveCount
          ? 0
          : Math.min(cyclePos - preserveCount, spacing - cyclePos);
        if (distToPreserve === 0 || distToPreserve > blendRange) continue;
        const blend = 1 - (distToPreserve / blendRange);
        const rowStart = y * w * 4;
        for (let x = 0; x < w; x++) {
          const i = rowStart + x * 4;
          out[i]   = out[i]   * (1-blend) + src[i]   * blend;
          out[i+1] = out[i+1] * (1-blend) + src[i+1] * blend;
          out[i+2] = out[i+2] * (1-blend) + src[i+2] * blend;
        }
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
timeSlider.addEventListener('input', () => {
  timeVal.textContent = timeSlider.value + 'ms';
  clearPresetActive();
  applyDrift();
});
spacingSlider.addEventListener('input', () => {
  spacingVal.textContent = spacingSlider.value + 'px';
  clearPresetActive();
  applyDrift();
});
preserveSlider.addEventListener('input', () => {
  preserveVal.textContent = preserveSlider.value + '%';
  clearPresetActive();
  applyDrift();
});
wobbleSlider.addEventListener('input', () => {
  wobbleVal.textContent = wobbleSlider.value + '%';
  clearPresetActive();
  applyDrift();
});
gradationSlider.addEventListener('input', () => {
  gradationVal.textContent = gradationSlider.value + '%';
  clearPresetActive();
  applyDrift();
});
directionSelect.addEventListener('change', applyDrift);
monochromeCheckbox.addEventListener('change', applyDrift);

// ── Drift Profile：数値ではなく「状態」でエフェクトを選ぶ
// 各プロファイルは intensity / time / spacing / preserve の組み合わせ
const DRIFT_PROFILES = {
  quiet:    { intensity: 25, time: 20, spacing: 6,  preserve: 45, wobble: 8,  gradation: 35 }, // 余白多い・線短い
  flow:     { intensity: 40, time: 40, spacing: 4,  preserve: 25, wobble: 15, gradation: 20 }, // 標準的な流れ
  memory:   { intensity: 55, time: 70, spacing: 8,  preserve: 20, wobble: 25, gradation: 60 }, // 淡く長い残像
  collapse: { intensity: 85, time: 30, spacing: 3,  preserve: 8,  wobble: 45, gradation: 10 }, // 輪郭ごと崩れる
  ghost:    { intensity: 95, time: 60, spacing: 12, preserve: 6,  wobble: 10, gradation: 50 }, // 極限まで希薄
};

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const profile = DRIFT_PROFILES[btn.dataset.profile];
    if (!profile) return;

    intensitySlider.value = profile.intensity;
    intensityVal.textContent = profile.intensity + '%';
    timeSlider.value = profile.time;
    timeVal.textContent = profile.time + 'ms';
    spacingSlider.value = profile.spacing;
    spacingVal.textContent = profile.spacing + 'px';
    preserveSlider.value = profile.preserve;
    preserveVal.textContent = profile.preserve + '%';
    wobbleSlider.value = profile.wobble;
    wobbleVal.textContent = profile.wobble + '%';
    gradationSlider.value = profile.gradation;
    gradationVal.textContent = profile.gradation + '%';

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

// ── テーマ切り替え（4種類の着せ替え）
const themeBtns = document.querySelectorAll('.theme-btn');
const THEME_CLASS_MAP = {
  default: null,
  natural: 'theme-natural',
  juno: 'theme-juno',
  warmth: 'theme-warmth',
};

function applyTheme(themeKey) {
  if (!(themeKey in THEME_CLASS_MAP)) return;
  // 既存のテーマクラスを全部外す
  Object.values(THEME_CLASS_MAP).forEach(cls => {
    if (cls) document.body.classList.remove(cls);
  });
  const cls = THEME_CLASS_MAP[themeKey];
  if (cls) document.body.classList.add(cls);

  themeBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.theme === themeKey);
  });

  try { localStorage.setItem('drift-theme', themeKey); } catch(e) {}
}

themeBtns.forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// 前回選んだテーマを復元（存在しない古いキーが残っていても無視する）
try {
  const savedTheme = localStorage.getItem('drift-theme');
  if (savedTheme && (savedTheme in THEME_CLASS_MAP)) {
    applyTheme(savedTheme);
  } else if (savedTheme) {
    // 古いバージョンのキーが残っていた場合はクリア
    localStorage.removeItem('drift-theme');
  }
} catch(e) {}
