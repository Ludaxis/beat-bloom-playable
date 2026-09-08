let studioTab = 'gameplay';
const studioTabs = ['gameplay', 'design', 'export'];
const designFields = [
  'end-headline',
  'end-cta-label',
  'end-cta-color',
  'end-background',
  'end-logo-width',
  'end-icon-size',
  'end-headline-size',
  'end-cta-size',
  'end-cta-width',
  'end-cta-height',
  'end-replay-enabled',
];
const hex = (color) => '#' + color.toString(16).padStart(6, '0');
function endCardControls() {
  const a = api(),
    design = a?.getEndCardDesign?.();
  if (!design) return;
  for (const id of designFields) $(`#${id}`).removeAttribute('aria-invalid');
  $('#design-status').dataset.error = 'false';
  $('#end-headline').value = design.headline;
  $('#end-cta-label').value = design.ctaLabel;
  $('#end-cta-color').value = hex(design.ctaColor);
  $('#end-background').value = hex(design.backgroundColor);
  $('#end-logo-width').value = design.logoWidth;
  $('#end-icon-size').value = design.iconSize;
  $('#end-headline-size').value = design.headlineSize ?? (profile.startsWith('b-') ? 44 : 38);
  $('#end-cta-size').value = design.ctaSize ?? 25;
  $('#end-cta-width').value = design.ctaWidth ?? 310;
  $('#end-cta-height').value = design.ctaHeight ?? 56;
  $('#end-replay-enabled').checked = design.replayEnabled !== false;
  designSizeLabels();
  if (typeof refreshDesignAssets === 'function') refreshDesignAssets(design);
  $('#design-concept').textContent = profile.startsWith('b-')
    ? 'Tagline + logo · headline above your brand.'
    : 'Free to play · brand, headline and footer.';
  if (studioTab === 'design') a.previewEndCard();
}
function designSizeLabels() {
  for (const id of [
    'end-logo-width',
    'end-icon-size',
    'end-headline-size',
    'end-cta-size',
    'end-cta-width',
    'end-cta-height',
  ])
    $(`#${id}-value`).value = $(`#${id}`).value + ' px';
}
function selectStudioTab(next, focus = false) {
  const a = api();
  if (next === 'design' && !a?.snapshot().ready) {
    message('Wait for the playable to finish loading.');
    return;
  }
  if (next === 'design' && !a.getEndCardDesign) {
    message('Reload Studio to use the latest ending design tools.');
    return;
  }
  if (next !== studioTab) $('.editor').scrollTop = 0;
  studioTab = next;
  $('#level-file-controls').hidden = next === 'export';
  for (const name of studioTabs) {
    const selected = name === next,
      button = $(`#${name}-tab`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#${name}-panel`).hidden = !selected;
  }
  $('.transport').hidden = next === 'design';
  $('.design-transport').hidden = next !== 'design';
  $('#preview-title').textContent = next === 'design' ? 'Ending preview' : 'Web playable';
  if (next === 'design') endCardControls();
  else a?.closeEndCardPreview?.();
  if (focus) $(`#${next}-tab`).focus({ preventScroll: true });
}
for (const name of studioTabs) {
  $(`#${name}-tab`).onclick = () => selectStudioTab(name);
  $(`#${name}-tab`).addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectStudioTab(
      event.key === 'Home'
        ? 'gameplay'
        : event.key === 'End'
          ? 'export'
          : studioTabs[(studioTabs.indexOf(studioTab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3],
      true,
    );
  });
}
$('#return-gameplay').onclick = () => selectStudioTab('gameplay', true);
$('#end-card').onclick = () => selectStudioTab('design');
function applyDesign(event) {
  const a = api();
  if (!a?.snapshot().ready) return;
  const id = event.currentTarget.id;
  const keys = {
    'end-headline': 'headline',
    'end-cta-label': 'ctaLabel',
    'end-cta-color': 'ctaColor',
    'end-background': 'backgroundColor',
    'end-logo-width': 'logoWidth',
    'end-icon-size': 'iconSize',
    'end-headline-size': 'headlineSize',
    'end-cta-size': 'ctaSize',
    'end-cta-width': 'ctaWidth',
    'end-cta-height': 'ctaHeight',
    'end-replay-enabled': 'replayEnabled',
  };
  const raw = event.currentTarget.value,
    value =
      id === 'end-replay-enabled'
        ? event.currentTarget.checked
        : id.endsWith('color') || id === 'end-background'
          ? parseInt(raw.slice(1), 16)
          : id === 'end-logo-width' ||
              id.endsWith('-size') ||
              id === 'end-cta-width' ||
              id === 'end-cta-height'
            ? Number(raw)
            : raw;
  try {
    a.setEndCardDesign({ [keys[id]]: value });
    $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
    designSizeLabels();
    event.currentTarget.removeAttribute('aria-invalid');
    $('#design-status').dataset.error = 'false';
    $('#design-status').textContent = 'Ending updated. Included in your export.';
  } catch (error) {
    $('#design-status').textContent = error.message;
  }
}
for (const id of designFields)
  $(`#${id}`).addEventListener(
    id === 'end-headline' || id === 'end-cta-label' ? 'change' : 'input',
    applyDesign,
  );
$('#reset-end-design').onclick = () => {
  const a = api();
  if (!a?.snapshot().ready) return;
  try {
    a.resetEndCardDesign();
    $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
    endCardControls();
    $('#design-status').textContent = 'Restored the approved ending layout.';
  } catch (error) {
    $('#design-status').textContent = error.message;
  }
};

function syncDesignPreview(snapshot) {
  if (
    studioTab === 'design' &&
    snapshot.endCard &&
    !snapshot.endCard.visible &&
    !snapshot.endCard.finishPreview
  )
    selectStudioTab('gameplay');
}

$('#preview-finish').onclick = () => api()?.previewFinish?.();
