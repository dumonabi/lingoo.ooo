const MIC_WAVE_SHIFT_MS = 46;
const MIC_BAR_WIDTH = 3;
const MIC_BAR_GAP = 2;
const MIC_WAVE_MIN_VISIBLE = 12;
const MIC_WAVE_MAX_VISIBLE = 160;
const MIC_BAR_IDLE = 0.05;
const MIC_BAR_TRIGGER = 0.22;
const MIC_VOICE_GATE = 0.1;

export function createMicWave() {
  let micMeter = null;
  let micMeterCtx = null;
  let micWaveSlots = [];
  let micWaveBarEls = [];
  let micWaveScrollEl = null;
  let micWaveLastShift = 0;
  let micWaveShiftBusy = false;
  let micWaveVisibleCount = MIC_WAVE_MIN_VISIBLE;
  let micWaveBarStep = MIC_BAR_WIDTH + MIC_BAR_GAP;
  let waveResizeObserver = null;

  function getMicMeterContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!micMeterCtx || micMeterCtx.state === 'closed') {
      micMeterCtx = new Ctx();
    }
    return micMeterCtx;
  }

  function primeMicAudioOnGesture() {
    const ctx = getMicMeterContext();
    if (!ctx || ctx.state !== 'suspended') return;
    void ctx.resume();
  }

  function measureWaveBars(levelEl, toolbarEl) {
    const step = MIC_BAR_WIDTH + MIC_BAR_GAP;
    const left = toolbarEl?.querySelector('.compose-toolbar-left');
    const right = toolbarEl?.querySelector('.compose-toolbar-right');

    let available = levelEl?.parentElement?.clientWidth || 0;
    if (toolbarEl && left && right) {
      const gap = Number.parseFloat(getComputedStyle(toolbarEl).columnGap) || 0;
      available = toolbarEl.clientWidth - left.offsetWidth - right.offsetWidth - gap * 2;
    }

    const visible = Math.min(
      MIC_WAVE_MAX_VISIBLE,
      Math.max(MIC_WAVE_MIN_VISIBLE, Math.floor((available + MIC_BAR_GAP) / step)),
    );

    return { visible, total: visible + 1, step };
  }

  function ensureLevelBars(levelEl, toolbarEl, force = false) {
    if (!levelEl) return;

    const { visible, total, step } = measureWaveBars(levelEl, toolbarEl);
    if (!force && micWaveScrollEl && micWaveBarEls.length === total && micWaveVisibleCount === visible) {
      return;
    }

    micWaveVisibleCount = visible;
    micWaveBarStep = step;
    levelEl.style.setProperty('--compose-wave-visible', String(visible));
    levelEl.innerHTML = '';
    micWaveBarEls.length = 0;
    micWaveScrollEl = document.createElement('span');
    micWaveScrollEl.className = 'compose-level-scroll';
    levelEl.appendChild(micWaveScrollEl);

    micWaveSlots = Array(total).fill(MIC_BAR_IDLE);
    for (let i = 0; i < total; i++) {
      const bar = document.createElement('span');
      bar.className = 'compose-level-bar';
      bar.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
      micWaveScrollEl.appendChild(bar);
      micWaveBarEls.push(bar);
    }
  }

  function readMicLevel() {
    if (!micMeter) return 0;

    micMeter.analyser.getByteTimeDomainData(micMeter.timeData);
    micMeter.analyser.getByteFrequencyData(micMeter.freqData);

    let sum = 0;
    for (let i = 0; i < micMeter.timeData.length; i++) {
      const sample = (micMeter.timeData[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / micMeter.timeData.length);

    let peak = 0;
    for (let i = 0; i < micMeter.freqData.length; i++) {
      if (micMeter.freqData[i] > peak) peak = micMeter.freqData[i];
    }
    const freqLevel = peak / 255;

    const raw = Math.min(1, Math.max(rms * 4.8, freqLevel * 1.45));
    const ease = raw > micMeter.smooth ? 0.88 : 0.22;
    micMeter.smooth += (raw - micMeter.smooth) * ease;
    return micMeter.smooth;
  }

  function isMicSilent(level) {
    if (!micMeter) return true;

    micMeter.analyser.getByteTimeDomainData(micMeter.timeData);
    let sum = 0;
    for (let i = 0; i < micMeter.timeData.length; i++) {
      const sample = (micMeter.timeData[i] - 128) / 128;
      sum += sample * sample;
    }
    const instant = Math.sqrt(sum / micMeter.timeData.length);
    return level < MIC_VOICE_GATE && instant < 0.025;
  }

  function computeWaveSample(level, silent) {
    if (silent || !micMeter) return MIC_BAR_IDLE;

    micMeter.analyser.getByteFrequencyData(micMeter.freqData);
    const voiceBins = Math.max(8, Math.floor(micMeter.freqData.length * 0.4));
    let peak = 0;
    for (let b = 2; b < 2 + voiceBins; b++) {
      peak = Math.max(peak, micMeter.freqData[b] / 255);
    }

    const gated = Math.max(0, peak - MIC_BAR_TRIGGER) / (1 - MIC_BAR_TRIGGER);
    if (gated < 0.07) return MIC_BAR_IDLE;

    const voiceLevel = Math.max(gated, Math.max(0, level - MIC_VOICE_GATE) * 0.55);
    const compressed = Math.pow(Math.min(1, voiceLevel * 0.82), 1.8);
    return MIC_BAR_IDLE + compressed * (1 - MIC_BAR_IDLE);
  }

  function finishMicWaveShift() {
    if (!micWaveScrollEl || !micWaveBarEls.length) return;

    const first = micWaveBarEls.shift();
    first.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
    micWaveScrollEl.appendChild(first);
    micWaveBarEls.push(first);

    micWaveScrollEl.style.transition = 'none';
    micWaveScrollEl.style.transform = 'translateX(0)';
    micWaveShiftBusy = false;
  }

  function shiftMicWaveform(sample) {
    if (!micWaveScrollEl || !micWaveBarEls.length || micWaveShiftBusy) return;

    micWaveShiftBusy = true;
    micWaveSlots.shift();
    micWaveSlots.push(sample);

    const incoming = micWaveBarEls[micWaveBarEls.length - 1];
    incoming.style.setProperty('--bar-scale', sample.toFixed(3));

    micWaveScrollEl.style.transition = `transform ${MIC_WAVE_SHIFT_MS}ms linear`;
    micWaveScrollEl.style.transform = `translateX(-${micWaveBarStep}px)`;

    window.setTimeout(finishMicWaveShift, MIC_WAVE_SHIFT_MS);
  }

  function clearMicVoicePulse() {
    micWaveLastShift = 0;
    micWaveShiftBusy = false;
    if (!micWaveBarEls.length) return;
    micWaveSlots = Array(micWaveBarEls.length).fill(MIC_BAR_IDLE);
    micWaveBarEls.forEach((bar) => {
      bar.style.setProperty('--bar-scale', String(MIC_BAR_IDLE));
    });
    if (micWaveScrollEl) {
      micWaveScrollEl.style.transition = 'none';
      micWaveScrollEl.style.transform = 'translateX(0)';
    }
  }

  function teardownMicMeter() {
    try {
      micMeter?.source?.disconnect();
      micMeter?.analyser?.disconnect();
      micMeter?.silentGain?.disconnect();
    } catch {
      // ignore disconnect errors
    }
    micMeter = null;
    clearMicVoicePulse();
  }

  function prepareMicMeter(stream) {
    if (micMeter?.stream === stream) {
      const ctx = getMicMeterContext();
      if (ctx?.state === 'suspended') void ctx.resume();
      return;
    }

    teardownMicMeter();

    const ctx = getMicMeterContext();
    if (!ctx || !stream?.active) return;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.12;
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(ctx.destination);

    micMeter = {
      stream,
      source,
      analyser,
      silentGain,
      timeData: new Uint8Array(analyser.fftSize),
      freqData: new Uint8Array(analyser.frequencyBinCount),
      smooth: 0,
    };

    if (ctx.state !== 'running') void ctx.resume();
  }

  function applyMicVoicePulse(levelEl, toolbarEl) {
    ensureLevelBars(levelEl, toolbarEl);
    if (!micMeter) return;

    const now = performance.now();
    if (now - micWaveLastShift < MIC_WAVE_SHIFT_MS || micWaveShiftBusy) return;
    micWaveLastShift = now;

    const level = readMicLevel();
    const silent = isMicSilent(level);
    if (silent && micMeter) micMeter.smooth *= 0.62;
    const sample = computeWaveSample(level, silent);
    shiftMicWaveform(sample);
  }

  function observeWaveResize(levelEl, toolbarEl, isActive) {
    unobserveWaveResize();
    if (!toolbarEl || typeof ResizeObserver === 'undefined') return;

    waveResizeObserver = new ResizeObserver(() => {
      if (!isActive()) return;
      ensureLevelBars(levelEl, toolbarEl, true);
    });
    waveResizeObserver.observe(toolbarEl);
  }

  function unobserveWaveResize() {
    waveResizeObserver?.disconnect();
    waveResizeObserver = null;
  }

  return {
    primeMicAudioOnGesture,
    prepareMicMeter,
    teardownMicMeter,
    applyMicVoicePulse,
    ensureLevelBars,
    observeWaveResize,
    unobserveWaveResize,
    clearMicVoicePulse,
  };
}
