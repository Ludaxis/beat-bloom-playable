function labelTransport(id, label) {
  const button = document.getElementById(id);
  if (button.title === label) return;
  button.setAttribute('aria-label', label);
  button.title = label;
}
const $ = (s) => document.querySelector(s),
  frame = $('#game');
let controlsInitialized = false,
  paused = false,
  profile = 'native',
  frameLoading = false,
  pendingSongLevel = null;
const api = () => {
  try {
    return frameLoading ? null : frame.contentWindow?.__beatBloom;
  } catch {
    return null;
  }
};
frame.addEventListener('load', () => {
  frameLoading = false;
});
function loadProfile(url) {
  if (typeof resetPatternSession === 'function') resetPatternSession();
  frameLoading = true;
  $('#fullscreen').disabled = true;
  frame.src = url;
}
function message(s) {
  const lines = s.split('\n');
  $('#editor-message').textContent =
    lines.length > 3 ? lines.slice(0, 3).join(' · ') + ` (${lines.length - 3} more checks)` : s;
}
function controls(level) {
  controlsInitialized = true;
  $('#shape').value = level.shape;
  $('#ball-speed').value = Math.round((level.ballSpeed ?? 1) * 100);
  $('#ball-size').value = (level.ballScale ?? 0.85) * 100;
  $('#layers').value = level.rings.length;
  $('#visible-layers').max = Math.min(12, level.rings.length);
  $('#visible-layers').value = level.arenaRingCapacity;
  $('#inner-radius').value = level.innerRadius;
  $('#thickness').value = level.lineThickness * 49;
  $('#spacing').value = level.lineSpacing * 49;
  $('#petals').value = level.flowerPetals;
  $('#roundness').value = level.roundness;
  if (typeof musicControls === 'function') musicControls(level);
  $('#level-json').value = JSON.stringify(level, null, 2);
  labels();
  appearanceControls();
  tutorialControls();
  if (typeof patternControls === 'function') patternControls(level);
  if (typeof endCardControls === 'function') endCardControls();
}
function labels() {
  $('#ball-speed-value').value = (Number($('#ball-speed').value) / 100).toFixed(2) + '×';
  $('#ball-size-value').value = $('#ball-size').value + '%';
  $('#inner-radius-value').value = (Number($('#inner-radius').value) * 49).toFixed(0) + ' px';
  $('#layers-value').value = $('#layers').value;
  $('#visible-layers-value').value = $('#visible-layers').value;
  $('#thickness-value').value = Number($('#thickness').value).toFixed(1) + ' px';
  $('#spacing-value').value = Number($('#spacing').value).toFixed(1) + ' px';
  $('#petals-value').value = $('#petals').value;
  $('#roundness-value').value = Math.round(Number($('#roundness').value) * 100) + '%';
  const flower = $('#shape').value === 'flower';
  $('#petals').disabled = !flower;
  $('#petals-control').hidden = !flower;
  $('#petals-unavailable').hidden = flower;
}
const appearanceFields = {
  'color-fade': 'colorFade',
  'shadow-opacity': 'shadowOpacity',
  'shadow-fade': 'shadowFade',
};
const appearanceMaximums = { 'color-fade': 30, 'shadow-opacity': 50, 'shadow-fade': 80 };
function appearanceLabel(id, percent) {
  const text = `${Number(percent.toFixed(4))}%`;
  $(`#${id}-value`).value = text;
  $(`#${id}`).setAttribute('aria-valuetext', text);
}
function appearanceLabels() {
  for (const id of Object.keys(appearanceFields)) appearanceLabel(id, Number($(`#${id}`).value));
}
function appearanceControls() {
  const appearance = api()?.getRingAppearance();
  if (!appearance) return;
  for (const [id, key] of Object.entries(appearanceFields)) {
    const percent = appearance[key] * 100,
      control = $(`#${id}`);
    control.max = Math.max(appearanceMaximums[id], Math.ceil(percent));
    control.value = percent;
    appearanceLabel(id, percent);
  }
}
for (const [id, key] of Object.entries(appearanceFields)) {
  $(`#${id}`).addEventListener('input', appearanceLabels);
  $(`#${id}`).addEventListener('change', () => {
    const a = api();
    if (!a?.snapshot().ready) return;
    try {
      const next = a.setOptions({
        ringAppearance: { ...a.getRingAppearance(), [key]: Number($(`#${id}`).value) / 100 },
      });
      $('#level-json').value = JSON.stringify(next, null, 2);
      appearanceControls();
      message('Ring depth updated.');
    } catch (e) {
      message(e.message);
      appearanceControls();
    }
  });
}
function tutorialControls() {
  const options = api()?.getTutorialOptions?.();
  if (!options) return;
  $('#tutorial-enabled').checked = options.enabled;
  $('#tutorial-placement').value = options.placement;
  $('#tutorial-placement').disabled = !options.enabled;
}
for (const id of ['tutorial-enabled', 'tutorial-placement'])
  $(`#${id}`).addEventListener('change', () => {
    const a = api();
    if (!a?.snapshot().ready) return;
    try {
      const next = a.setOptions({
        tutorial: {
          enabled: $('#tutorial-enabled').checked,
          placement: $('#tutorial-placement').value,
        },
      });
      $('#level-json').value = JSON.stringify(next, null, 2);
      tutorialControls();
      message('Hints updated.');
    } catch (e) {
      message(e.message);
      tutorialControls();
    }
  });
function change(event) {
  labels();
  if (!api()?.snapshot().ready) return;
  const target = event?.currentTarget || $('#shape'),
    fields = {
      'ball-size': ['ballScale', 100],
      'ball-speed': ['ballSpeed', 100],
      shape: ['shape', 1],
      'inner-radius': ['innerRadius', 1],
      thickness: ['lineThickness', 49],
      spacing: ['lineSpacing', 49],
      petals: ['flowerPetals', 1],
      roundness: ['roundness', 1],
    };
  try {
    const field = fields[target.id];
    const options =
      target.type === 'color'
        ? {
            palette: [...$('.palette').querySelectorAll('input[type=color]')].map((i) =>
              parseInt(i.value.slice(1), 16),
            ),
          }
        : field
          ? { [field[0]]: target.id === 'shape' ? target.value : Number(target.value) / field[1] }
          : {};
    const l = api().setOptions(options);
    $('#level-json').value = JSON.stringify(l, null, 2);
    if (typeof patternControls === 'function') patternControls(l);
    message('Level updated.');
  } catch (e) {
    message(e.message);
    controls(api().getLevel());
  }
}
for (const s of [
  '#ball-size',
  '#ball-speed',
  '#shape',
  '#inner-radius',
  '#thickness',
  '#spacing',
  '#petals',
  '#roundness',
])
  $(s).addEventListener('change', change);
for (const s of [
  '#ball-size',
  '#ball-speed',
  '#inner-radius',
  '#thickness',
  '#spacing',
  '#petals',
  '#roundness',
  '#layers',
  '#visible-layers',
])
  $(s).addEventListener('input', labels);
$('.palette')
  .querySelectorAll('input')
  .forEach((i) => i.addEventListener('change', change));
$('#layers').addEventListener('change', () => {
  if (!api()?.snapshot().ready) return;
  try {
    const level = api().setLayerCount(Number($('#layers').value));
    controls(level);
    message(`${level.rings.length} rings. ${level.queue.length} balls, 3 power each.`);
  } catch (e) {
    message(e.message);
    controls(api().getLevel());
  }
});
$('#visible-layers').addEventListener('change', () => {
  if (!api()?.snapshot().ready) return;
  try {
    const count = Number($('#visible-layers').value),
      current = api().getLevel();
    const level = api().setOptions({
      arenaRingCapacity: count,
      maxRenderedRings: Math.max(current.maxRenderedRings, count + current.previewRingCount),
    });
    controls(level);
    message(`${count} colored layers visible at once.`);
  } catch (e) {
    message(e.message);
    controls(api().getLevel());
  }
});
$('#restart').onclick = () => {
  api()?.restart();
  message('Level restarted.');
};
$('#pause').onclick = () => {
  paused = !paused;
  api()?.pause(paused);
  labelTransport('pause', paused ? 'Resume' : 'Pause');
  $('#pause').setAttribute('aria-pressed', String(paused));
};
$('#sound').onclick = () => {
  const s = api()?.snapshot();
  if (s) api().setMuted(!s.music.muted);
};
$('#step').onclick = () => {
  paused = true;
  api()?.pause(true);
  api()?.step(1 / 60);
  labelTransport('pause', 'Resume');
  $('#pause').setAttribute('aria-pressed', 'true');
};
$('#save').onclick = () => {
  if (!api()) return;
  const l = api().getLevel(),
    a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(l, null, 2)], { type: 'application/json' }),
  );
  a.download = `beat-bloom-${l.shape}-level.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  message('Level saved.');
};
$('#load').onclick = () => $('#load-file').click();
async function applyText(text) {
  try {
    await loadAuthoredLevel(JSON.parse(text));
  } catch (e) {
    message('Level was not changed: ' + e.message);
  }
}
$('#load-file').onchange = async () => {
  const f = $('#load-file').files[0];
  if (f) await applyText(await f.text());
  $('#load-file').value = '';
};
$('#apply-json').onclick = () => applyText($('#level-json').value);
let lastPreviewError = '';
// The iframe owns gameplay; Studio polls only its lightweight authoring status.
setInterval(() => {
  if (document.hidden) return;
  try {
    const a = api(),
      s = a?.snapshot();
    $('#fullscreen').disabled = !s?.ready;
    $('#export-playable').disabled = exportBusy || !s?.ready;
    if (!s?.ready) return;
    if (pendingSongLevel) applyPendingSong(a);
    if (typeof musicTick === 'function') musicTick(a);
    if (!controlsInitialized) controls(a.getLevel());
    if (typeof syncDesignPreview === 'function') syncDesignPreview(s);
    $('#game-state').textContent =
      typeof studioTab !== 'undefined' && studioTab === 'design'
        ? 'Design preview'
        : s.status === 'won'
          ? 'Complete'
          : s.paused
            ? 'Paused'
            : `${s.time.toFixed(1)} s`;
    labelTransport('sound', s.music.muted ? 'Unmute sound' : 'Mute sound');
    $('#sound').setAttribute('aria-pressed', String(s.music.muted));
    lastPreviewError = '';
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail !== lastPreviewError) {
      lastPreviewError = detail;
      message(`Preview could not update: ${detail}`);
      console.error('Studio preview update failed', error);
    }
  }
}, 250);

let exportURL = '',
  exportBusy = false;
function exportControls() {
  const network = $('#export-network').value,
    meta = network === 'meta',
    zip = $('#export-format').value === 'zip';
  $('.store-destinations').hidden = meta;
  for (const id of ['store-ios', 'store-android']) $(`#${id}`).disabled = meta;
  $('#destination-help').textContent = meta
    ? 'Set the destination in Meta Ads Manager.'
    : network === 'applovin'
      ? 'Uses your store links. Set tracking in AppLovin.'
      : 'Uses your store links. Set tracking in Unity.';
  $('#export-format-help').textContent = zip
    ? meta
      ? 'Contains index.html. HTML limit: 2 MB.'
      : 'Unzip, then upload index.html.'
    : `All assets included. ${meta ? '2 MB' : '5 MB'} limit.`;
  $('#network-guide').href = meta
    ? 'https://www.facebook.com/business/help/412951382532338'
    : network === 'applovin'
      ? 'https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines'
      : 'https://docs.unity.com/en-us/grow/acquire/creatives/playable/specifications';
}
$('#export-network').addEventListener('change', exportControls);
$('#export-format').addEventListener('change', exportControls);
exportControls();
$('#export-playable').onclick = async () => {
  const current = api();
  if (exportBusy || !current?.snapshot().ready) return;
  const button = $('#export-playable'),
    status = $('#export-status'),
    network = $('#export-network').value,
    format = $('#export-format').value,
    level = current.getLevel(),
    selectedProfile = profile;
  exportBusy = true;
  button.disabled = true;
  button.textContent = 'Building playable…';
  status.dataset.error = 'false';
  status.textContent = `Packaging ${level.shape} · ${level.rings.length} layers for ${$('#export-network').selectedOptions[0].textContent}…`;
  $('#export-download').hidden = true;
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        network,
        profile: selectedProfile,
        level,
        format,
        ...(network === 'meta'
          ? {}
          : {
              storeURLs: {
                ios: $('#store-ios').value.trim(),
                android: $('#store-android').value.trim(),
              },
            }),
      }),
    });
    if (!response.ok) {
      const result = await response
        .json()
        .catch(() => ({ error: 'Unable to build the playable.' }));
      throw Error(result.error || 'Unable to build the playable.');
    }
    const file = await response.blob(),
      filename =
        /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] ||
        `beat-bloom-${network}.${format}`;
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(file);
    const link = $('#export-download');
    link.href = exportURL;
    link.download = filename;
    link.textContent = `Download ${filename}`;
    link.hidden = false;
    link.click();
    const bytes = Number(response.headers.get('X-Playable-HTML-Bytes')),
      cap = Number(response.headers.get('X-Playable-Limit-Bytes'));
    status.textContent = `Downloaded. ${(bytes / 1000000).toFixed(2)} / ${(cap / 1000000).toFixed(0)} MB. Test in the network’s validator.`;
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally {
    exportBusy = false;
    button.disabled = !api()?.snapshot().ready;
    button.textContent = 'Download playable';
  }
};
addEventListener('beforeunload', () => {
  if (exportURL) URL.revokeObjectURL(exportURL);
  if (typeof cancelSolvability === 'function') cancelSolvability();
});

$('#fullscreen').onclick = () => {
  const current = api();
  if (!current?.snapshot().ready) {
    message('Still loading. Try again in a moment.');
    return;
  }
  try {
    const id = crypto.randomUUID(),
      snapshot = JSON.stringify({ version: 1, profile, level: current.getLevel() });
    if (new TextEncoder().encode(snapshot).length > 256 * 1024)
      throw Error('This level is too large to open. Save its JSON and reduce the level size.');
    localStorage.setItem(`beatbloom:studio-preview:${id}`, snapshot);
    window.open(
      `${musicPreviewURL(profile, current.getLevel().songId)}${musicPreviewURL(profile, current.getLevel().songId).includes('?') ? '&' : '?'}studioLevel=${id}`,
      '_blank',
      'noopener',
    );
    message('Opened in a new tab.');
  } catch (error) {
    message('Unable to open this level: ' + error.message);
  }
};
