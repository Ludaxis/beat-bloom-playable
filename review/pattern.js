// Studio-only pattern authoring. Exported playables contain the resulting level, not these tools.
let ringTemplates = [],
  patternUndo = null,
  solveWorker = null,
  solveTimer = 0,
  solveRevision = 0,
  solveKey = '',
  autoCheck = false,
  lastSolveResult = null;
window.__beatBloomStudio = {
  getSolvability: () => (lastSolveResult ? structuredClone(lastSolveResult) : null),
};
const patternInputIds = ['color-count', 'segments-per-ring', 'colors-per-ring'];
const typical = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 1;
};
const clampNumber = (n, min, max) => Math.max(min, Math.min(max, n));

function patternBounds() {
  const rings = Number($('#layers').value),
    segments = Number($('#segments-per-ring').value);
  $('#color-count').max = Math.min(12, rings * segments);
  $('#color-count').value = Math.min(
    Number($('#color-count').value),
    Number($('#color-count').max),
  );
  const colors = Number($('#color-count').value),
    perRing = $('#colors-per-ring');
  perRing.min = Math.max(1, Math.ceil(colors / rings));
  perRing.max = Math.min(colors, segments);
  perRing.value = clampNumber(Number(perRing.value), Number(perRing.min), Number(perRing.max));
  $('#color-count-help').textContent =
    Number($('#color-count').max) < 12
      ? `This layout fits up to ${$('#color-count').max} colors. Add rings or segments to use more.`
      : 'Balls update to match your colors.';
  perRing.disabled = perRing.min === perRing.max;
  $('#colors-per-ring-help').hidden = !perRing.disabled;
  $('#colors-per-ring-help').textContent =
    `This layout needs ${perRing.min} ${Number(perRing.min) === 1 ? 'color' : 'colors'} per ring. Add rings or segments for more options.`;
  for (const id of patternInputIds) $(`#${id}-value`).value = $(`#${id}`).value;
  $('#pattern-shift-value').value = `${Number(Number($('#pattern-shift-fine').value).toFixed(4))}°`;
  const corners = $('#shape').value === 'hexagon' ? 6 : 0,
    n = Number(perRing.value);
  const segmentInput = $('#segments-per-ring'),
    equal = $('#equal-color-spans').checked,
    segmentValue = segmentInput.value;
  segmentInput.min = equal ? n : 1;
  segmentInput.max = equal ? Math.floor(24 / n) * n : 24;
  segmentInput.step = equal ? n : 1;
  segmentInput.value = segmentValue;
  $('#segments-per-ring-value').value = segmentInput.value;
  $('#equal-color-spans-help').textContent = $('#equal-color-spans').checked
    ? `${corners && corners % n === 0 ? `${corners / n} ${corners / n === 1 ? 'corner' : 'corners'} per color at 0° shift. ` : ''}Segments use multiples of ${n} for equal spans.`
    : 'Exact segment count. Color spans may differ.';
  for (const id of ['shape-speed', 'segment-speed'])
    $(`#${id}-value`).value =
      Number($(`#${id}`).value) === 0 ? 'Stopped' : `${Number($(`#${id}`).value).toFixed(1)}×`;
}

function patternControls(level) {
  const recipe = api()?.getPatternOptions?.();
  const validRecipe =
    recipe &&
    recipe.colorCount === level.palette.length &&
    ['segmentsPerRing', 'colorsPerRing', 'shift'].every((k) => Number.isInteger(recipe[k])) &&
    recipe.segmentsPerRing >= 1 &&
    recipe.segmentsPerRing <= 24 &&
    recipe.colorsPerRing >= 1 &&
    recipe.colorsPerRing <= Math.min(recipe.colorCount, recipe.segmentsPerRing) &&
    recipe.shift >= 0 &&
    recipe.shift < recipe.segmentsPerRing;
  $('#segments-per-ring').min = 1;
  $('#segments-per-ring').max = 24;
  $('#segments-per-ring').step = 1;
  $('#segments-per-ring').value = validRecipe
    ? recipe.segmentsPerRing
    : typical(level.rings.map((r) => r.length));
  // Set bounds before assigning so a previous one-color recipe cannot clamp a loaded palette.
  $('#color-count').max = 12;
  $('#color-count').value = level.palette.length;
  $('#colors-per-ring').max = 12;
  $('#colors-per-ring').min = 1;
  $('#colors-per-ring').value = validRecipe
    ? recipe.colorsPerRing
    : typical(level.rings.map((r) => new Set(r.filter((c) => c >= 0)).size));
  $('#equal-color-spans').checked = validRecipe
    ? (recipe.equalColorSpans ?? recipe.segmentsPerRing % recipe.colorsPerRing === 0)
    : false;
  const shift = level.ringShiftDegrees ?? recipe?.shiftDegrees ?? 0;
  $('#pattern-shift').value = shift;
  $('#pattern-shift-fine').value = shift;
  $('#shape-speed').value = level.motion.conveyorHoldFigure ? 0 : level.motion.speedMultiplier / 2;
  $('#segment-speed').value =
    level.motion.conveyorBeatsPerSlot > 0 ? 12 / level.motion.conveyorBeatsPerSlot : 0;
  patternBounds();
  $('#pattern-status').textContent = validRecipe
    ? 'Shift moves colors along each ring.'
    : 'Custom pattern. Changing colors or segments rebuilds it.';
  drawPattern(level);
  const key = solvabilityKey(level);
  if (key !== solveKey) {
    cancelSolvability();
    solveKey = key;
    setSolveStatus('unchecked', 'Enough ball power. Winning route not checked yet.');
    if (autoCheck) scheduleSolvability();
  }
}

function drawPattern(level) {
  const svg = $('#pattern-map'),
    ns = 'http://www.w3.org/2000/svg',
    rowHeight = 7;
  svg.setAttribute('viewBox', `0 0 240 ${level.rings.length * rowHeight}`);
  svg.replaceChildren();
  level.rings.forEach((ring, row) =>
    ring.forEach((color, column) => {
      const width = 240 / ring.length,
        x = (((column * width + (level.ringPhaseOffsets?.[row] ?? 0) * 240) % 240) + 240) % 240;
      // Split wrapping rectangles explicitly so fine offsets remain visible in this unwrapped map.
      for (const [start, length] of [
        [x, Math.min(width - 0.7, 240 - x)],
        [0, Math.max(0, x + width - 0.7 - 240)],
      ]) {
        if (length <= 0) continue;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(start));
        rect.setAttribute('y', String(row * rowHeight));
        rect.setAttribute('width', String(length));
        rect.setAttribute('height', '5');
        rect.setAttribute('rx', '1');
        rect.setAttribute(
          'fill',
          color < 0 ? '#493d58' : '#' + level.palette[color].toString(16).padStart(6, '0'),
        );
        svg.append(rect);
      }
    }),
  );
  const colors = new Set(level.rings.flat().filter((c) => c >= 0));
  svg.setAttribute(
    'aria-label',
    `${level.rings.length} rings, ${colors.size} used colors, ${level.rings.flat().filter((c) => c >= 0).length} pieces. Center ring first.`,
  );
}

function commitPattern(level, text) {
  controls(level);
  $('#pattern-template').value = '';
  $('#pattern-template').onchange();
  message(text);
}
function makePattern() {
  const current = api();
  if (!current?.snapshot().ready) return;
  patternBounds();
  const before = current.getLevel();
  try {
    const next = current.setPattern({
      colorCount: Number($('#color-count').value),
      segmentsPerRing: Number($('#segments-per-ring').value),
      colorsPerRing: Number($('#colors-per-ring').value),
      shift: 0,
      shiftDegrees: Number($('#pattern-shift-fine').value),
      equalColorSpans: $('#equal-color-spans').checked,
    });
    patternUndo = before;
    $('#undo-pattern').disabled = false;
    autoCheck = true;
    commitPattern(
      next,
      `Pattern updated. ${next.queue.length} balls × 3 power cover ${next.rings.flat().filter((c) => c >= 0).length} pieces. Checking a winning route…`,
    );
  } catch (error) {
    controls(before);
    message('Pattern was not changed: ' + error.message);
  }
}
for (const id of patternInputIds) {
  $(`#${id}`).addEventListener('input', patternBounds);
  $(`#${id}`).addEventListener('change', makePattern);
}
$('#equal-color-spans').addEventListener('change', makePattern);

function changeContinuousShift(target) {
  const current = api();
  if (!current?.snapshot().ready) return;
  const before = current.getLevel();
  try {
    const degrees = Number(target.value);
    if (!target.value.trim() || !Number.isFinite(degrees) || Math.abs(degrees) > 180)
      throw Error('Use −180° to 180°. Decimals work too.');
    const next = current.setPatternShift(degrees);
    patternUndo = before;
    $('#undo-pattern').disabled = false;
    autoCheck = true;
    commitPattern(
      next,
      'Continuous ring offset updated. Ring pieces and ball power are unchanged.',
    );
  } catch (error) {
    controls(before);
    message('Shift was not changed: ' + error.message);
  }
}
$('#pattern-shift').addEventListener('input', () => {
  $('#pattern-shift-fine').value = $('#pattern-shift').value;
  patternBounds();
});
$('#pattern-shift-fine').addEventListener('input', () => {
  const n = Number($('#pattern-shift-fine').value);
  if (Number.isFinite(n) && Math.abs(n) <= 180) {
    $('#pattern-shift').value = n;
    patternBounds();
  }
});
for (const id of ['pattern-shift', 'pattern-shift-fine'])
  $(`#${id}`).addEventListener('change', (event) => changeContinuousShift(event.currentTarget));

for (const id of ['shape-speed', 'segment-speed']) {
  $(`#${id}`).addEventListener('input', patternBounds);
  $(`#${id}`).addEventListener('change', () => {
    const current = api();
    if (!current?.snapshot().ready) return;
    const before = current.getLevel();
    try {
      const shapeSpeed = Number($('#shape-speed').value),
        segmentSpeed = Number($('#segment-speed').value);
      const next = current.setOptions({
        motion: {
          ...before.motion,
          speedMultiplier: shapeSpeed * 2,
          conveyorHoldFigure: shapeSpeed === 0,
          conveyorBeatsPerSlot: segmentSpeed > 0 ? 12 / segmentSpeed : 0,
        },
      });
      autoCheck = true;
      controls(next);
      message('Speed updated. Checking…');
    } catch (error) {
      controls(before);
      message('Motion was not changed: ' + error.message);
    }
  });
}

$('#apply-template').onclick = () => {
  const current = api(),
    template = ringTemplates.find((t) => t.id === $('#pattern-template').value);
  if (!current?.snapshot().ready || !template) return;
  const before = current.getLevel();
  try {
    const next = current.applyRingTemplate({ rings: template.rings, palette: template.palette });
    patternUndo = before;
    $('#undo-pattern').disabled = false;
    autoCheck = true;
    controls(next);
    message(`${template.label} pattern applied.`);
  } catch (error) {
    message('Pattern was not changed: ' + error.message);
  }
};
$('#undo-pattern').onclick = () => {
  if (!patternUndo || !api()?.snapshot().ready) return;
  try {
    const previous = patternUndo;
    api().setLevel(previous);
    patternUndo = null;
    $('#undo-pattern').disabled = true;
    commitPattern(previous, 'Previous pattern restored.');
  } catch (error) {
    message(error.message);
  }
};
$('#pattern-template').onchange = () => {
  const template = ringTemplates.find((t) => t.id === $('#pattern-template').value);
  $('#apply-template').disabled = !template;
  if (!template) {
    $('#template-description').textContent = 'Applies rings and colors only.';
    return;
  }
  const counts = template.rings.map((r) => r.length),
    min = Math.min(...counts),
    max = Math.max(...counts);
  $('#template-description').textContent =
    `${template.rings.length} rings · ${template.palette.length} colors · ${min === max ? min : `${min}–${max}`} segments per ring.`;
};
fetch('/review/data/ring-templates.json')
  .then((response) => {
    if (!response.ok) throw Error('Game patterns are unavailable.');
    return response.json();
  })
  .then((data) => {
    if (data.version !== 1 || !Array.isArray(data.templates) || data.templates.length !== 20)
      throw Error('Expected the 20 game patterns.');
    ringTemplates = data.templates;
    const select = $('#pattern-template');
    select.replaceChildren(
      new Option('Choose a game pattern…', ''),
      ...ringTemplates.map((t) => new Option(t.label, t.id)),
    );
    select.disabled = false;
  })
  .catch((error) => {
    $('#template-description').textContent = error.message;
    $('#pattern-template').replaceChildren(new Option('Patterns unavailable', ''));
  });

// RGB edits do not change physics or the solve result; palette indexes and all gameplay tuning do.
function solvabilityKey(level) {
  const {
    palette,
    name,
    id,
    levelNumber,
    source,
    pattern,
    ringAppearance,
    tutorial,
    endCard,
    ...physics
  } = level;
  return JSON.stringify({ ...physics, colorCount: palette.length });
}
function setSolveStatus(state, text) {
  $('#solve-status').dataset.state = state;
  $('#solve-status').textContent = text;
}
function cancelSolvability() {
  solveRevision++;
  clearTimeout(solveTimer);
  solveWorker?.terminate();
  solveWorker = null;
  lastSolveResult = null;
  $('#check-solvable').textContent = 'Check solvability';
}
function scheduleSolvability() {
  clearTimeout(solveTimer);
  solveTimer = setTimeout(checkSolvability, 400);
}
function checkSolvability({ longer = false, shuffle = false } = {}) {
  const current = api();
  if (!current?.snapshot().ready) return;
  cancelSolvability();
  const revision = solveRevision,
    level = current.getLevel();
  solveKey = solvabilityKey(level);
  setSolveStatus('checking', shuffle ? 'Finding a solvable shuffle…' : 'Checking for a win…');
  $('#check-solvable').textContent = 'Cancel check';
  try {
    solveWorker = new Worker('/review/pattern-worker.js');
    solveWorker.onmessage = (event) => {
      if (revision !== solveRevision) return;
      const data = event.data;
      if (data.type === 'progress') {
        setSolveStatus('checking', `Checking… ${data.remaining ?? '…'} pieces left.`);
        return;
      }
      solveWorker?.terminate();
      solveWorker = null;
      $('#check-solvable').textContent = 'Check again';
      if (shuffle && data.queue && data.result?.status === 'verified-win') {
        if (solvabilityKey(current.getLevel()) !== solveKey) return;
        patternUndo = current.getLevel();
        const next = current.setLevel({ ...patternUndo, queue: data.queue });
        solveKey = solvabilityKey(next);
        $('#undo-pattern').disabled = false;
        commitPattern(next, 'Balls shuffled. Verified win.');
      }
      lastSolveResult = data.result ? { levelKey: solveKey, ...data.result } : null;
      if (data.result?.status === 'verified-win')
        setSolveStatus(
          'verified-win',
          `Verified win. ${level.rings.flat().filter((c) => c >= 0).length} pieces cleared.`,
        );
      else {
        setSolveStatus(
          'not-verified',
          data.error ||
            (longer
              ? 'No win found yet. Try fewer colors or slower movement.'
              : 'No win found yet. Try a longer check.'),
        );
        $('#check-solvable').textContent = longer ? 'Check again' : 'Run longer check';
      }
    };
    solveWorker.onerror = () => {
      if (revision !== solveRevision) return;
      cancelSolvability();
      setSolveStatus('not-verified', 'Check interrupted. Try again.');
    };
    solveWorker.postMessage({
      level,
      shuffle,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      maxWallTimeMs: longer ? 60000 : 12000,
    });
  } catch (error) {
    cancelSolvability();
    setSolveStatus('not-verified', 'The solve check is unavailable: ' + error.message);
  }
}
$('#shuffle-balls').onclick = () => checkSolvability({ shuffle: true, longer: true });
$('#check-solvable').onclick = () => {
  autoCheck = true;
  if (solveWorker) {
    cancelSolvability();
    setSolveStatus('unchecked', 'Check cancelled. The level is unchanged.');
  } else checkSolvability({ longer: true });
};
function resetPatternSession() {
  cancelSolvability();
  solveKey = '';
  patternUndo = null;
  autoCheck = false;
  $('#undo-pattern').disabled = true;
  $('#pattern-template').value = '';
  $('#pattern-template').onchange();
  setSolveStatus('unchecked', 'Check if the level can be cleared.');
}
