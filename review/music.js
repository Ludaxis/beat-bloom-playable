// Studio song selection, color-to-stem authoring, and a bounded local draft.
const STUDIO_DRAFT_KEY = 'beatbloom:studio-draft:v1',
  legacySongChoices = { native: 'kissmemore', 'a-heart': 'nobatidao', 'a-flower': 'sunflower' };
let songCatalog = [],
  musicInitialized = false,
  musicSwitchMode = 'song',
  rememberedStemMaps = Object.create(null),
  lastDraft = '',
  draftWriteFailed = false,
  musicControlKey = '',
  songLoadFailure = null;
const songForChoice = (choice) => legacySongChoices[choice] || choice;
const choiceForSong = (songId) =>
  Object.keys(legacySongChoices).find((choice) => legacySongChoices[choice] === songId) || songId;
function musicPreviewURL(selectedProfile, songId) {
  return `/dist/preview/${selectedProfile}.html?song=${encodeURIComponent(songId)}`;
}
function rememberStemMap(level) {
  rememberedStemMaps[level.songId] = {
    colorCount: level.palette.length,
    lanes: structuredClone(level.stemLanes),
  };
}
function songMetadata(level) {
  return songCatalog.find((song) => song.id === level.songId) || api()?.getSong?.();
}
function defaultStemLanes(level, song) {
  const stems = song.stems.filter((stem) => stem.earnable);
  return stems.map((stem, index) => {
    const colors = level.palette
      .map((_, color) => color)
      .filter((color) => color % stems.length === index);
    if (!colors.length) colors.push(index % level.palette.length);
    return { stem: stem.index, colors, requiredBreaks: 1 };
  });
}
function recalledStemLanes(level, song) {
  const saved = rememberedStemMaps[song.id];
  if (!saved) return defaultStemLanes(level, song);
  const available = new Set(song.stems.filter((stem) => stem.earnable).map((stem) => stem.index));
  const lanes = saved.lanes
    .filter((lane) => available.has(lane.stem))
    .map((lane) => ({
      ...lane,
      colors: lane.colors.filter((color) => color < level.palette.length),
    }))
    .filter((lane) => lane.colors.length);
  // Keep authored omissions. Only colors added since this song was edited receive defaults.
  for (const lane of defaultStemLanes(level, song)) {
    const additions = lane.colors.filter((color) => color >= saved.colorCount);
    if (!additions.length) continue;
    const existing = lanes.find((item) => item.stem === lane.stem);
    if (existing) existing.colors.push(...additions);
    else lanes.push({ ...lane, colors: additions });
  }
  return lanes;
}
function stopStemListening() {
  api()?.stopAudition?.();
  updateListenButtons();
}
function updateListenButtons() {
  const state = api()?.getAuditionState?.() || { stem: null, loading: false, error: '' };
  document.querySelectorAll('[data-listen-stem]').forEach((button) => {
    const playing = Number(button.dataset.listenStem) === state.stem;
    button.textContent = playing ? (state.loading ? 'Loading…' : 'Stop') : 'Listen';
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute(
      'aria-label',
      `${playing ? 'Stop' : 'Listen to'} ${button.dataset.stemLabel}`,
    );
  });
  $('#stem-listen-status').textContent = state.error || '';
}
async function listenToStem(index) {
  const current = api();
  if (!current?.snapshot().ready) return;
  if (current.getAuditionState?.().stem === index) {
    stopStemListening();
    return;
  }
  paused = true;
  current.pause(true);
  labelTransport('pause', 'Resume');
  $('#pause').setAttribute('aria-pressed', 'true');
  try {
    const pending = current.auditionStem(index);
    updateListenButtons();
    await pending;
  } catch (error) {
    message('Unable to listen: ' + error.message);
  }
  updateListenButtons();
}
function musicControls(level) {
  const song = songMetadata(level);
  if (!song) return;
  musicControlKey = JSON.stringify([level.songId, level.palette, level.stemLanes]);
  const table = $('#stem-assignments');
  table.replaceChildren();
  const caption = document.createElement('caption');
  caption.textContent = `${song.title} sounds`;
  caption.className = 'visually-hidden';
  table.append(caption);
  const header = table.createTHead().insertRow(),
    corner = document.createElement('th');
  corner.scope = 'col';
  corner.textContent = 'Color';
  header.append(corner);
  const stems = song.stems.filter((stem) => stem.earnable);
  for (const stem of stems) {
    const th = document.createElement('th'),
      label = document.createElement('span'),
      listen = document.createElement('button');
    th.scope = 'col';
    label.textContent = stem.label;
    listen.type = 'button';
    listen.dataset.listenStem = stem.index;
    listen.dataset.stemLabel = stem.label;
    listen.textContent = 'Listen';
    listen.addEventListener('click', () => listenToStem(stem.index));
    th.append(label, listen);
    header.append(th);
  }
  const body = table.createTBody();
  for (let color = 0; color < level.palette.length; color++) {
    const row = body.insertRow(),
      heading = document.createElement('th'),
      colorLabel = document.createElement('label'),
      input = document.createElement('input'),
      number = document.createElement('span');
    heading.scope = 'row';
    input.type = 'color';
    input.value = '#' + level.palette[color].toString(16).padStart(6, '0');
    input.setAttribute(
      'aria-label',
      ['First color', 'Second color', 'Third color', 'Fourth color'][color] || `Color ${color + 1}`,
    );
    input.addEventListener('change', change);
    number.textContent = String(color + 1);
    colorLabel.append(input, number);
    heading.append(colorLabel);
    row.append(heading);
    for (const stem of stems) {
      const cell = row.insertCell(),
        label = document.createElement('label'),
        checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.stem = stem.index;
      checkbox.dataset.color = color;
      checkbox.setAttribute('aria-label', `${stem.label}, color ${color + 1}`);
      checkbox.checked = level.stemLanes.some(
        (lane) => lane.stem === stem.index && lane.colors.includes(color),
      );
      checkbox.addEventListener('change', setStemAssignment);
      label.append(checkbox);
      cell.append(label);
    }
  }
  const backing = $('#stem-bed-preview');
  backing.replaceChildren();
  for (const stem of song.stems.filter((entry) => !entry.earnable)) {
    const label = document.createElement('span'),
      button = document.createElement('button');
    label.textContent = `${stem.label} · always on`;
    button.type = 'button';
    button.dataset.listenStem = stem.index;
    button.dataset.stemLabel = stem.label;
    button.textContent = 'Listen';
    button.addEventListener('click', () => listenToStem(stem.index));
    backing.append(label, button);
  }
  $('#reset-stems').disabled = !stems.length;
  updateListenButtons();
}
function setStemAssignment(event) {
  const current = api();
  if (!current?.snapshot().ready) return;
  const input = event.currentTarget,
    stem = Number(input.dataset.stem),
    color = Number(input.dataset.color),
    level = current.getLevel(),
    lanes = structuredClone(level.stemLanes);
  let lane = lanes.find((entry) => entry.stem === stem);
  if (input.checked) {
    if (!lane) lanes.push((lane = { stem, colors: [], requiredBreaks: 1 }));
    if (!lane.colors.includes(color)) lane.colors.push(color);
    lane.colors.sort((a, b) => a - b);
  } else if (lane) lane.colors = lane.colors.filter((entry) => entry !== color);
  try {
    const next = current.setOptions({
      stemLanes: lanes.filter((entry) => entry.colors.length).sort((a, b) => a.stem - b.stem),
    });
    rememberStemMap(next);
    musicControlKey = JSON.stringify([next.songId, next.palette, next.stemLanes]);
    $('#level-json').value = JSON.stringify(next, null, 2);
    message('Sounds updated.');
    saveStudioDraft(next);
  } catch (error) {
    input.checked = !input.checked;
    message(error.message);
  }
}
$('#reset-stems').onclick = () => {
  const current = api();
  if (!current?.snapshot().ready) return;
  const level = current.getLevel(),
    song = songMetadata(level);
  if (!song) return;
  try {
    const next = current.setOptions({ stemLanes: defaultStemLanes(level, song) });
    rememberStemMap(next);
    controls(next);
    saveStudioDraft(next);
    message('Assignments reset.');
  } catch (error) {
    message(error.message);
  }
};
function beginSongLoad(songId, level, mode = 'song') {
  const song = songCatalog.find((entry) => entry.id === songId);
  if (!song) throw Error('This song is not in the library.');
  const choice = choiceForSong(songId);
  stopStemListening();
  pendingSongLevel = structuredClone(level);
  musicSwitchMode = mode;
  profile = Object.hasOwn(legacySongChoices, choice) ? choice : 'native';
  $('#profile').value = choice;
  controlsInitialized = false;
  songLoadFailure = null;
  loadProfile(musicPreviewURL(profile, songId));
  paused = false;
  labelTransport('pause', 'Pause');
  $('#pause').setAttribute('aria-pressed', 'false');
  message('Loading song…');
}
$('#profile').onchange = () => {
  const current = api(),
    level = pendingSongLevel || current?.getLevel();
  if (!level) return;
  if (current) rememberStemMap(current.getLevel());
  try {
    beginSongLoad(songForChoice($('#profile').value), level);
  } catch (error) {
    message(error.message);
  }
};
function applyPendingSong(current) {
  if (!pendingSongLevel || songLoadFailure) return;
  try {
    const next = structuredClone(pendingSongLevel),
      loaded = current.getLevel(),
      song = songMetadata(loaded);
    if (!song) return;
    if (musicSwitchMode === 'song') {
      for (const key of ['songId', 'bpm', 'beatsPerBar', 'loopBeats', 'downbeatOffset', 'sections'])
        next[key] = structuredClone(loaded[key]);
      if (next.referenceCalibration) delete next.referenceCalibration.audioSourceOffsetSeconds;
      next.stemLanes = recalledStemLanes(next, song);
    }
    const level = current.setLevel(next);
    pendingSongLevel = null;
    controls(level);
    rememberStemMap(level);
    saveStudioDraft(level);
    message(
      musicSwitchMode === 'draft'
        ? 'Draft restored.'
        : musicSwitchMode === 'level'
          ? 'Level loaded.'
          : 'Song ready.',
    );
  } catch (error) {
    songLoadFailure = error;
    if (musicSwitchMode === 'draft') {
      pendingSongLevel = null;
      controls(current.getLevel());
      message('This draft could not load. Load saved level JSON to recover your edits.');
      songLoadFailure = null;
    } else message('Unable to load this level: ' + error.message);
  }
}
async function loadAuthoredLevel(level) {
  await musicLibraryReady;
  if (!level || typeof level !== 'object' || !songCatalog.some((song) => song.id === level.songId))
    throw Error('This level needs a song from the library.');
  const current = api();
  if (!current?.snapshot().ready) throw Error('Wait for the song to finish loading.');
  if (level.songId === current.getLevel().songId) {
    const next = current.setLevel(level);
    rememberStemMap(next);
    controls(next);
    saveStudioDraft(next);
    message('Level loaded.');
  } else {
    // Validate before leaving the current preview; runtime provides the same authored boundary.
    current.validateLevel(level);
    rememberStemMap(current.getLevel());
    beginSongLoad(level.songId, level, 'level');
  }
}
function saveStudioDraft(level) {
  if (!musicInitialized || pendingSongLevel) return;
  rememberStemMap(level);
  const raw = JSON.stringify({ version: 1, profile, level, stemMaps: rememberedStemMaps });
  if (raw === lastDraft) return;
  try {
    if (new TextEncoder().encode(raw).length > 512 * 1024) throw Error('Draft is too large.');
    localStorage.setItem(STUDIO_DRAFT_KEY, raw);
    lastDraft = raw;
    draftWriteFailed = false;
  } catch {
    if (!draftWriteFailed)
      message('Draft could not be saved in this browser. Save level JSON to keep your edits.');
    draftWriteFailed = true;
  }
}
function musicTick(current) {
  if (!musicInitialized || pendingSongLevel) return;
  const level = current.getLevel(),
    key = JSON.stringify([level.songId, level.palette, level.stemLanes]);
  if (key !== musicControlKey) musicControls(level);
  updateListenButtons();
  saveStudioDraft(level);
}
const musicLibraryReady = fetch('/assets/music/catalog.json')
  .then((response) => {
    if (!response.ok) throw Error('Song library could not load. Refresh to try again.');
    return response.json();
  })
  .then((catalog) => {
    if (!Array.isArray(catalog)) throw Error('Song library is unavailable.');
    songCatalog = catalog;
    const select = $('#profile'),
      group = document.createElement('optgroup');
    group.label = 'Drop Sort';
    for (const song of catalog) {
      const choice = choiceForSong(song.id);
      if (![...select.options].some((option) => option.value === choice))
        group.append(new Option(song.title, choice));
    }
    select.append(group);
    select.disabled = false;
    musicInitialized = true;
    let draft;
    try {
      const raw = localStorage.getItem(STUDIO_DRAFT_KEY);
      if (raw && raw.length <= 512 * 1024) draft = JSON.parse(raw);
    } catch {
      /* A blocked or invalid local draft must not prevent a fresh preview. */
    }
    if (
      draft?.version === 1 &&
      draft.level &&
      songCatalog.some((song) => song.id === draft.level.songId)
    ) {
      if (draft.stemMaps && typeof draft.stemMaps === 'object') {
        for (const [id, saved] of Object.entries(draft.stemMaps)) {
          if (
            !songCatalog.some((song) => song.id === id) ||
            !Number.isInteger(saved?.colorCount) ||
            saved.colorCount < 1 ||
            saved.colorCount > 12 ||
            !Array.isArray(saved.lanes)
          )
            continue;
          if (
            saved.lanes.every(
              (lane) =>
                Number.isInteger(lane.stem) &&
                Array.isArray(lane.colors) &&
                lane.colors.every(
                  (color) => Number.isInteger(color) && color >= 0 && color < saved.colorCount,
                ),
            )
          )
            rememberedStemMaps[id] = saved;
        }
      }
      beginSongLoad(draft.level.songId, draft.level, 'draft');
    }
  })
  .catch((error) => {
    message(error.message);
  });
addEventListener('pagehide', () => {
  const current = api();
  if (current?.snapshot().ready && !pendingSongLevel) saveStudioDraft(current.getLevel());
  stopStemListening();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStemListening();
});
