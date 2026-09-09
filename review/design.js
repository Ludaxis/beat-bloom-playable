let studioTab = 'gameplay';
let introPreview = false;
let lastIntroLayout = 'logo';
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
  const flow = a.getLevel().adFlow;
  if (flow?.intro && flow.intro !== 'none') lastIntroLayout = flow.intro;
  else if (flow?.design)
    lastIntroLayout = flow.design.bannerEnabled && !flow.design.logoEnabled ? 'footer' : 'logo';
  $('#intro-enabled').checked = !!flow && flow.intro !== 'none';
  $('#intro-controls').hidden = !$('#intro-enabled').checked;
  if (typeof refreshIntroDesign === 'function') refreshIntroDesign();
  $('#intro-layout').value = flow?.intro || 'none';
  $('#intro-tagline').value = flow?.tagline || 'Harder than you think';
  $('#intro-tagline-field').hidden = !a.getIntroDesign().logoEnabled;
  $('#intro-help').hidden = !flow || flow.intro === 'none';
  $('#preview-intro').hidden = !flow || flow.intro === 'none';
  designSizeLabels();
  if (typeof refreshDesignAssets === 'function') refreshDesignAssets(design);
  $('#design-concept').textContent = profile.startsWith('b-')
    ? 'Tagline + logo'
    : 'Free to play footer';
  if (studioTab === 'design') {
    if (!introPreview) a.previewEndCard();
    updateDesignPreviewTitle();
  }
}
function updateDesignPreviewTitle() {
  $('#preview-title').textContent = introPreview ? 'Intro preview' : 'Ending preview';
  $('#preview-intro').setAttribute('aria-pressed', String(introPreview));
  $('#preview-ending').setAttribute('aria-pressed', String(!introPreview));
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
    message('Still loading. Try again in a moment.');
    return;
  }
  if (next === 'design' && !a.getEndCardDesign) {
    message('Reload Studio to update.');
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
  $('#preview-title').textContent = next === 'design' ? 'Ending preview' : 'Live preview';
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
    introPreview = false;
    a.previewEndCard();
    updateDesignPreviewTitle();
    a.setEndCardDesign({ [keys[id]]: value });
    $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
    designSizeLabels();
    event.currentTarget.removeAttribute('aria-invalid');
    $('#design-status').dataset.error = 'false';
    $('#design-status').textContent = 'Ending updated.';
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
    $('#design-status').textContent = 'Design reset.';
  } catch (error) {
    $('#design-status').textContent = error.message;
  }
};

function syncDesignPreview(snapshot) {
  if (
    studioTab === 'design' &&
    !introPreview &&
    snapshot.endCard &&
    !snapshot.endCard.visible &&
    !snapshot.endCard.finishPreview
  )
    selectStudioTab('gameplay');
}

$('#preview-finish').onclick = () => {
  introPreview = false;
  updateDesignPreviewTitle();
  api()?.previewFinish?.();
};

function updateIntro() {
  try {
    const a = api();
    if (!$('#intro-tagline').value.trim()) return;
    introPreview = true;
    if ($('#intro-layout').value === a.getLevel().adFlow?.intro) {
      a.setIntroDesign({}, $('#intro-tagline').value);
    } else
      a.setOptions({
        adFlow: {
          ...a.getLevel().adFlow,
          intro: $('#intro-layout').value,
          tagline: $('#intro-tagline').value,
          design: {
            ...a.getIntroDesign(),
            ...($('#intro-layout').value !== 'none' &&
            a.getLevel().adFlow?.intro !== 'none' &&
            $('#intro-layout').value !== a.getLevel().adFlow?.intro
              ? {
                  logoEnabled: $('#intro-layout').value === 'logo',
                  bannerEnabled: $('#intro-layout').value === 'footer',
                }
              : {}),
          },
        },
      });
    $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
    endCardControls();
  } catch (error) {
    $('#design-status').textContent = error.message;
  }
}
$('#intro-layout').onchange = updateIntro;
$('#intro-tagline').oninput = updateIntro;
$('#preview-intro').onclick = () => {
  introPreview = true;
  api()?.restart();
  updateDesignPreviewTitle();
};
$('#preview-ending').onclick = () => {
  introPreview = false;
  api()?.previewEndCard();
  updateDesignPreviewTitle();
};

$('#intro-enabled').onchange = () => {
  $('#intro-layout').value = $('#intro-enabled').checked ? lastIntroLayout : 'none';
  updateIntro();
};
