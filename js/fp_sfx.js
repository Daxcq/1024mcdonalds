/* fp_sfx.js — synthesised sound effects, no assets, no network, file:// safe. */
(function () {
  'use strict';
  var FP = (window.FP = window.FP || {});

  var ctx = null;
  var masterGain = null;
  var compressor = null;
  var noiseBuffer = null;
  var aliveCount = 0;
  var MAX_VOICES = 24;
  var enabled = true;

  try {
    var stored = localStorage.getItem('fp_sfx_on');
    if (stored === '0') enabled = false;
    else if (stored === '1') enabled = true;
  } catch (e) { /* ignore */ }

  function floorRamp(v) { return Math.max(0.0001, v); }

  function trackVoice(node) {
    aliveCount++;
    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      aliveCount = Math.max(0, aliveCount - 1);
      try { node.disconnect(); } catch (e) { /* ignore */ }
    }
    node.onended = cleanup;
    return cleanup;
  }

  function canStartVoice() {
    return aliveCount < MAX_VOICES;
  }

  function ensureNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    var len = Math.floor(ctx.sampleRate * 1);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return noiseBuffer;
  }

  function makeNoiseSource() {
    var src = ctx.createBufferSource();
    src.buffer = ensureNoiseBuffer();
    src.loop = true;
    var maxStart = Math.max(0, noiseBuffer.duration - 0.05);
    src.loopStart = 0;
    src.loopEnd = noiseBuffer.duration;
    try { src.start(ctx.currentTime, Math.random() * maxStart); }
    catch (e) { try { src.start(); } catch (e2) { /* ignore */ } }
    return src;
  }
  function gainNode(g) {
    var gn = ctx.createGain();
    gn.gain.value = g;
    return gn;
  }

  function playClick() {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.05);
    var g = gainNode(0.0001);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(g); g.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + 0.07);
  }

  function playPick() {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);
    var og = gainNode(0.0001);
    og.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(og); og.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + 0.13);

    var noise = makeNoiseSource();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;
    var ng = gainNode(0.0001);
    ng.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    noise.connect(bp); bp.connect(ng); ng.connect(compressor);
    trackVoice(noise);
    noise.stop(now + 0.11);
  }
  function playDrop(opts) {
    var now = ctx.currentTime;
    var i = (opts && typeof opts.i === 'number') ? opts.i : 0;
    var step = Math.min(i, 12);
    var base = 90 + step * 4;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(base, now + 0.1);
    var og = gainNode(0.0001);
    og.gain.exponentialRampToValueAtTime(0.5, now + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(og); og.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + 0.22);

    var noise = makeNoiseSource();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200 + step * 20;
    var ng = gainNode(0.0001);
    ng.gain.exponentialRampToValueAtTime(0.25, now + 0.015);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    noise.connect(lp); lp.connect(ng); ng.connect(compressor);
    trackVoice(noise);
    noise.stop(now + 0.15);
  }

  function playSquish() {
    var now = ctx.currentTime;
    var dur = 0.35;
    var noise = makeNoiseSource();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, now);
    lp.frequency.exponentialRampToValueAtTime(220, now + dur * 0.45);
    lp.frequency.exponentialRampToValueAtTime(1400, now + dur);
    var ng = gainNode(0.0001);
    ng.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(lp); lp.connect(ng); ng.connect(compressor);
    trackVoice(noise);
    noise.stop(now + dur + 0.02);

    var wob = ctx.createOscillator();
    wob.type = 'sine';
    wob.frequency.setValueAtTime(70, now);
    wob.frequency.linearRampToValueAtTime(40, now + dur * 0.5);
    wob.frequency.linearRampToValueAtTime(90, now + dur);
    var wg = gainNode(0.0001);
    wg.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    wg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    wob.connect(wg); wg.connect(compressor);
    trackVoice(wob);
    wob.start(now); wob.stop(now + dur + 0.02);
  }
  function playSprinkle() {
    var now = ctx.currentTime;
    var dur = 0.4;
    var grains = 18;
    for (var k = 0; k < grains; k++) {
      var t = now + (k / grains) * dur + Math.random() * 0.01;
      var noise = makeNoiseSource();
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4000 + Math.random() * 3000;
      var g = gainNode(0.0001);
      var peak = 0.05 + Math.random() * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.015);
      noise.connect(hp); hp.connect(g); g.connect(compressor);
      trackVoice(noise);
      noise.stop(t + 0.04);
    }
  }

  function playUndo() {
    var now = ctx.currentTime;
    var freqs = [700, 420];
    for (var k = 0; k < freqs.length; k++) {
      var t = now + k * 0.09;
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freqs[k], t);
      var g = gainNode(0.0001);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(g); g.connect(compressor);
      trackVoice(osc);
      osc.start(t); osc.stop(t + 0.08);
    }
  }

  function playClear() {
    var now = ctx.currentTime;
    var dur = 0.35;
    var noise = makeNoiseSource();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3500, now);
    bp.frequency.exponentialRampToValueAtTime(220, now + dur);
    bp.Q.value = 1.1;
    var ng = gainNode(0.0001);
    ng.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(bp); bp.connect(ng); ng.connect(compressor);
    trackVoice(noise);
    noise.stop(now + dur + 0.02);
    var thudT = now + dur * 0.85;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, thudT);
    osc.frequency.exponentialRampToValueAtTime(60, thudT + 0.1);
    var og = gainNode(0.0001);
    og.gain.exponentialRampToValueAtTime(0.4, thudT + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, thudT + 0.15);
    osc.connect(og); og.connect(compressor);
    trackVoice(osc);
    osc.start(thudT); osc.stop(thudT + 0.16);
  }

  function playDing() {
    var now = ctx.currentTime;
    var dur = 0.9;
    var partials = [1, 2.76];
    var gains = [0.3, 0.18];
    for (var k = 0; k < partials.length; k++) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 880 * partials[k];
      var g = gainNode(0.0001);
      g.gain.exponentialRampToValueAtTime(gains[k], now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g); g.connect(compressor);
      trackVoice(osc);
      osc.start(now); osc.stop(now + dur + 0.02);
    }
  }

  function playGood() {
    var now = ctx.currentTime;
    var notes = [523.25, 659.25, 784, 1046.5, 1318.5];
    var step = 0.1;
    for (var k = 0; k < notes.length; k++) {
      var t = now + k * step;
      var osc = ctx.createOscillator();
      osc.type = (k % 2 === 0) ? 'square' : 'triangle';
      osc.frequency.value = notes[k];
      var g = gainNode(0.0001);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
      osc.connect(g); g.connect(compressor);
      trackVoice(osc);
      osc.start(t); osc.stop(t + step * 1.7);
    }
  }
  function playOk() {
    var now = ctx.currentTime;
    var notes = [523.25, 659.25];
    var step = 0.14;
    for (var k = 0; k < notes.length; k++) {
      var t = now + k * step;
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = notes[k];
      var g = gainNode(0.0001);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.3);
      osc.connect(g); g.connect(compressor);
      trackVoice(osc);
      osc.start(t); osc.stop(t + step * 1.4);
    }
  }

  function playBad() {
    var now = ctx.currentTime;
    var dur = 0.8;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(300, now + dur);
    var g = gainNode(0.0001);
    g.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(lp); lp.connect(g); g.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  function playPrint(opts) {
    var now = ctx.currentTime;
    var dur = (opts && typeof opts.dur === 'number') ? opts.dur : 1200;
    dur = Math.max(100, Math.min(5000, dur)) / 1000;
    var tickGap = 0.045;
    var count = Math.max(1, Math.floor(dur / tickGap));
    for (var k = 0; k < count; k++) {
      var t = now + k * tickGap;
      var noise = makeNoiseSource();
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500 + Math.random() * 800;
      bp.Q.value = 6;
      var g = gainNode(0.0001);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      noise.connect(bp); bp.connect(g); g.connect(compressor);
      trackVoice(noise);
      noise.stop(t + 0.03);
    }
  }
  function playBeep(opts) {
    var now = ctx.currentTime;
    var i = (opts && typeof opts.i === 'number') ? opts.i : 0;
    var step = Math.min(i, 12);
    var freq = 700 * Math.pow(2, step / 12);
    var osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    var g = gainNode(0.0001);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(g); g.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + 0.09);
  }

  function playStamp() {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.14);
    var g = gainNode(0.0001);
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g); g.connect(compressor);
    trackVoice(osc);
    osc.start(now); osc.stop(now + 0.22);

    var noise = makeNoiseSource();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    var ng = gainNode(0.0001);
    ng.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noise.connect(hp); hp.connect(ng); ng.connect(compressor);
    trackVoice(noise);
    noise.stop(now + 0.06);
  }

  function playWhoosh(opts) {
    var now = ctx.currentTime;
    var dir = (opts && opts.dir === 'out') ? 'out' : 'in';
    var dur = 0.45;
    var noise = makeNoiseSource();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    if (dir === 'in') {
      bp.frequency.setValueAtTime(300, now);
      bp.frequency.exponentialRampToValueAtTime(3200, now + dur);
    } else {
      bp.frequency.setValueAtTime(3200, now);
      bp.frequency.exponentialRampToValueAtTime(300, now + dur);
    }
    var g = gainNode(0.0001);
    g.gain.exponentialRampToValueAtTime(0.26, now + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(bp); bp.connect(g); g.connect(compressor);
    trackVoice(noise);
    noise.stop(now + dur + 0.02);
  }
  var PLAYERS = {
    click: playClick,
    pick: playPick,
    drop: playDrop,
    squish: playSquish,
    sprinkle: playSprinkle,
    undo: playUndo,
    clear: playClear,
    ding: playDing,
    good: playGood,
    ok: playOk,
    bad: playBad,
    print: playPrint,
    beep: playBeep,
    stamp: playStamp,
    whoosh: playWhoosh
  };

  var NAMES = Object.keys(PLAYERS);

  function setupGraph() {
    if (compressor) return;
    compressor = ctx.createDynamicsCompressor();
    try {
      compressor.threshold.value = -24;
      compressor.knee.value = 24;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
    } catch (e) { /* ignore, defaults are fine */ }
    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 0.25 : 0.0001;
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
  }
  FP.sfx = {
    enabled: enabled,
    names: NAMES,

    unlock: function () {
      try {
        if (!ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          setupGraph();
        }
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          ctx.resume();
        }
      } catch (e) { /* never throw */ }
    },

    play: function (name, opts) {
      try {
        if (!FP.sfx.enabled) return;
        if (!ctx || ctx.state !== 'running') return;
        if (!canStartVoice()) return;
        var fn = PLAYERS[name];
        if (typeof fn !== 'function') return;
        fn(opts);
      } catch (e) { /* never throw */ }
    },

    setEnabled: function (on) {
      try {
        enabled = !!on;
        FP.sfx.enabled = enabled;
        try { localStorage.setItem('fp_sfx_on', enabled ? '1' : '0'); }
        catch (e2) { /* ignore storage errors */ }
        if (masterGain && ctx) {
          var now = ctx.currentTime;
          var target = enabled ? 0.25 : 0.0001;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(floorRamp(masterGain.gain.value), now);
          masterGain.gain.exponentialRampToValueAtTime(floorRamp(target), now + 0.15);
        }
      } catch (e) { /* never throw */ }
    },
    test: function () {
      var i = 0;
      return new Promise(function (resolve) {
        function step() {
          if (i >= NAMES.length) { resolve(); return; }
          try { FP.sfx.play(NAMES[i]); } catch (e) { /* ignore */ }
          i++;
          setTimeout(step, 900);
        }
        step();
      });
    }
  };

  Object.defineProperty(FP.sfx, '_ctx', {
    get: function () { return ctx; }
  });
  Object.defineProperty(FP.sfx, '_alive', {
    get: function () { return aliveCount; }
  });
})();

