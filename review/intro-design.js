const introFields = [
  ['headline', 'Headline', 'text', 60],
  ['headlineSize', 'Headline size', 'range', 18, 64],
  ['playLabel', 'Button text', 'text', 24],
  ['playSize', 'Button text size', 'range', 16, 40],
  ['playWidth', 'Width', 'range', 100, 360],
  ['playHeight', 'Button height', 'range', 44, 100],
  ['playColor', 'Button color', 'color'],
  ['dim', 'Background dim', 'range', 0, 90],
  ['logoEnabled', 'Show logo', 'checkbox'],
  ['logoWidth', 'Width', 'range', 48, 340],
  ['taglineSize', 'Tagline size', 'range', 14, 40],
];
for (const key of ['logo', 'tagline', 'headline', 'play']) {
  introFields.push(
    [key + 'X', 'Horizontal', 'range', -160, 160],
    [key + 'Y', 'Vertical', 'range', key === 'logo' ? -260 : -240, key === 'logo' ? 260 : 240],
  );
}
introFields.push(['handEnabled', 'Show hand', 'checkbox'], ['textColor', 'Text color', 'color']);
const bannerFields = [
  ['bannerHeight', 'Height', 'range', 64, 160],
  ['bannerText', 'Text', 'text', 24],
  ['bannerTextSize', 'Text size', 'range', 10, 28],
  ['bannerColor', 'Background', 'color'],
  ['iconSize', 'Icon size', 'range', 24, 96],
  ['installLabel', 'Button text', 'text', 24],
  ['installSize', 'Button text size', 'range', 12, 28],
  ['installWidth', 'Button width', 'range', 72, 160],
  ['installHeight', 'Button height', 'range', 44, 80],
  ['installColor', 'Button color', 'color'],
];
function introFieldMarkup([key, label, type, min, max]) {
  const id = 'intro-design-' + key;
  if (type === 'checkbox')
    return `<label class="flow-check"><input id="${id}" type="checkbox">${label}</label>`;
  return `<label class="flow-field${type === 'range' ? ' flow-slider' : type === 'color' ? ' flow-color' : ''}" for="${id}">${label}${type === 'range' ? `<output id="${id}-value"></output>` : ''}<input id="${id}" type="${type}" ${type === 'range' ? `min="${min}" max="${max}" step="1"` : type === 'text' ? `maxlength="${min}"` : ''}></label>`;
}
function introAssetMarkup(key) {
  return `<div class="flow-asset-row"><button type="button" class="flow-asset" id="intro-upload-${key}"><span class="flow-asset-picture"><img id="intro-${key}-asset" alt="Intro ${key}"></span><span>↑ Upload ${key}</span></button><button class="flow-asset-reset" id="intro-reset-${key}" type="button">Reset ${key}</button><input id="intro-${key}-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>`;
}
$('#intro-fields').innerHTML =
  introAssetMarkup('logo') + introFields.map(introFieldMarkup).join('');
$('#intro-banner-fields').innerHTML =
  introAssetMarkup('icon') + bannerFields.map(introFieldMarkup).join('');
function refreshIntroDesign() {
  const design = api()?.getIntroDesign?.();
  if (!design) return;
  for (const [key, , type] of [...introFields, ...bannerFields]) {
    const input = $('#intro-design-' + key);
    if (type === 'checkbox') input.checked = design[key];
    else input.value = type === 'color' ? hex(design[key]) : design[key];
    if (type === 'range')
      $('#intro-design-' + key + '-value').value = design[key] + (key === 'dim' ? '%' : ' px');
  }
  $('#intro-tagline-field').hidden = false;
  for (const card of document.querySelectorAll('[data-intro-concept]')) {
    const selected = card.dataset.introConcept === design.concept;
    card.setAttribute('aria-checked', String(selected));
    card.tabIndex = selected ? 0 : -1;
  }
  $('#intro-banner-enabled').checked = design.bannerEnabled;
  $('#intro-banner-fields').hidden = !design.bannerEnabled;
  for (const key of ['logo', 'icon']) {
    const url = design[key + 'Image'] || '/assets/' + key + '.webp';
    const card = $('#intro-' + key + '-asset');
    if (card.getAttribute('src') !== url) card.src = url;
  }
}
function editIntroDesign(patch) {
  introPreview = true;
  api().setIntroDesign(patch);
  $('#level-json').value = JSON.stringify(api().getLevel(), null, 2);
  refreshIntroDesign();
  updateDesignPreviewTitle();
}
for (const [key, , type] of [...introFields, ...bannerFields]) {
  $('#intro-design-' + key).addEventListener('input', (event) => {
    const input = event.currentTarget;
    if (type === 'text' && !input.value.trim()) return;
    try {
      editIntroDesign({
        [key]:
          type === 'checkbox'
            ? input.checked
            : type === 'range'
              ? Number(input.value)
              : type === 'color'
                ? parseInt(input.value.slice(1), 16)
                : input.value,
      });
    } catch (error) {
      $('#design-status').textContent = error.message;
    }
  });
}
$('#intro-banner-enabled').onchange = () =>
  editIntroDesign({ bannerEnabled: $('#intro-banner-enabled').checked });
$('#reset-intro-design').onclick = () => {
  const a = api(),
    level = a.getLevel();
  introPreview = true;
  const flow = { ...level.adFlow };
  delete flow.design;
  // Explicit reset uses product artwork, without copying the ending's uploaded files.
  a.setOptions({ adFlow: { ...flow, design: {} } });
  $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
  refreshIntroDesign();
  updateDesignPreviewTitle();
};
for (const key of ['logo', 'icon']) {
  $('#intro-upload-' + key).onclick = () => $('#intro-' + key + '-file').click();
  $('#intro-' + key + '-file').onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const a = api(),
      original = JSON.stringify(a.getLevel());
    try {
      const url = await prepareDesignImage(file);
      if (a !== api() || JSON.stringify(a.getLevel()) !== original)
        throw Error('The level changed. Upload again.');
      editIntroDesign({ [key + 'Image']: url });
    } catch (error) {
      $('#design-status').textContent = error.message;
    }
  };
}

// Reuse the existing editor bindings while grouping the controls like Drop Sort Studio.
const introSection = $('#intro-section');
introSection.classList.add('ds-flow-editor');
const enableLabel = $('#intro-enabled').closest('label');
enableLabel.className = 'flow-enabled';
enableLabel.lastChild.textContent = 'Enable intro';
$('#intro-layout').closest('label').hidden = true;
const chevron =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>';
const concepts = [
  ['classic', 'First tap'],
  ['spotlight', 'Spotlight'],
  ['invitation', 'Invitation'],
];
const cards = document.createElement('div');
cards.className = 'flow-concepts';
cards.setAttribute('role', 'radiogroup');
cards.setAttribute('aria-label', 'Opening style');
cards.innerHTML = concepts
  .map(
    ([key, label]) =>
      `<button type="button" class="flow-concept" data-intro-concept="${key}" role="radio" aria-checked="false" aria-label="${label}"><span class="flow-mini flow-mini-${key}" aria-hidden="true"><span class="flow-mini-shade"></span><span class="flow-mini-card"></span><img class="flow-mini-logo" src="/assets/logo.webp" alt=""><span class="flow-mini-line"></span><span class="flow-mini-start">Play</span><span class="flow-mini-install"></span></span><span class="flow-concept-label">${label}<span class="flow-concept-check">✓</span></span></button>`,
  )
  .join('');
enableLabel.after(cards);
function group(title, nodes, open = false) {
  const section = document.createElement('details');
  section.className = 'flow-group';
  section.open = open;
  section.innerHTML = `<summary>${title}${chevron}</summary><div class="flow-group-body"></div>`;
  const body = section.querySelector('div');
  for (const node of nodes) if (node) body.append(node);
  return section;
}
const field = (key) => $('#intro-design-' + key).closest('label');
const position = (key) => {
  const row = document.createElement('div');
  row.className = 'flow-position-fields';
  row.append(field(key + 'X'), field(key + 'Y'));
  return row;
};
const logoAsset = $('#intro-upload-logo').closest('.flow-asset-row');
const tagline = $('#intro-tagline-field');
tagline.className = 'flow-field';
const sections = [
  group('Logo', [field('logoEnabled'), logoAsset, field('logoWidth'), position('logo')], true),
  group('Tagline', [tagline, field('taglineSize'), position('tagline')]),
  group('Headline', [
    field('headline'),
    field('headlineSize'),
    position('headline'),
    field('textColor'),
  ]),
  group('Start button', [
    field('playLabel'),
    field('playSize'),
    field('playWidth'),
    field('playHeight'),
    position('play'),
    field('playColor'),
    field('handEnabled'),
  ]),
];
const dimField = field('dim');
$('#intro-fields').replaceChildren(...sections);
const banner = $('#intro-banner-section');
banner.className = 'flow-group';
banner.open = false;
banner.querySelector('summary').innerHTML = 'Banner' + chevron;
const bannerBody = document.createElement('div');
bannerBody.className = 'flow-group-body';
bannerBody.append($('#intro-banner-enabled').closest('label'), $('#intro-banner-fields'));
banner.append(bannerBody);
$('#intro-banner-enabled').closest('label').className = 'flow-check';
banner.after(dimField);
$('#preview-intro').className = 'flow-preview';
$('#reset-intro-design').className = 'flow-reset-design';
$('#intro-controls').append($('#preview-intro'), $('#reset-intro-design'));
for (const [index, card] of [...cards.children].entries()) {
  const choose = () => {
    const concept = card.dataset.introConcept;
    const presets = {
      classic: {
        logoWidth: 116,
        headlineSize: 41,
        taglineSize: 27,
        playWidth: 275,
        playHeight: 64,
        playSize: 30,
      },
      spotlight: {
        logoWidth: 308,
        headlineSize: 30,
        taglineSize: 25,
        playWidth: 245,
        playHeight: 59,
        playSize: 27,
      },
      invitation: {
        logoWidth: 116,
        headlineSize: 33,
        taglineSize: 22,
        playWidth: 314,
        playHeight: 64,
        playSize: 30,
      },
    };
    if (!$('#intro-enabled').checked) {
      $('#intro-enabled').checked = true;
      $('#intro-enabled').dispatchEvent(new Event('change'));
    }
    editIntroDesign({
      concept,
      ...presets[concept],
      logoX: 0,
      logoY: 0,
      taglineX: 0,
      taglineY: 0,
      headlineX: 0,
      headlineY: 0,
      playX: 0,
      playY: 0,
    });
  };
  card.onclick = choose;
  card.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    cards.children[next].click();
    cards.children[next].focus();
  };
}
for (const key of ['logo', 'icon'])
  $('#intro-reset-' + key).onclick = () => editIntroDesign({ [key + 'Image']: undefined });
