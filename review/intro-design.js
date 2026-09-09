const introFields = [
  ['headline', 'Headline', 'text', 60],
  ['headlineSize', 'Headline size', 'range', 18, 64],
  ['playLabel', 'Button text', 'text', 24],
  ['playSize', 'Button text size', 'range', 16, 40],
  ['playWidth', 'Button width', 'range', 100, 300],
  ['playHeight', 'Button height', 'range', 44, 100],
  ['playColor', 'Button color', 'color'],
  ['dim', 'Background dim', 'range', 0, 90],
  ['logoEnabled', 'Show logo and tagline', 'checkbox'],
  ['logoWidth', 'Logo width', 'range', 48, 240],
  ['taglineSize', 'Tagline size', 'range', 14, 40],
];
const bannerFields = [
  ['bannerText', 'Text', 'text', 24],
  ['bannerTextSize', 'Text size', 'range', 12, 28],
  ['bannerColor', 'Background', 'color'],
  ['iconSize', 'Icon size', 'range', 24, 80],
  ['installLabel', 'Button text', 'text', 24],
  ['installSize', 'Button text size', 'range', 12, 28],
  ['installWidth', 'Button width', 'range', 72, 160],
  ['installHeight', 'Button height', 'range', 44, 80],
  ['installColor', 'Button color', 'color'],
];
function introFieldMarkup([key, label, type, min, max]) {
  const id = 'intro-design-' + key;
  if (type === 'checkbox')
    return `<label class="pattern-toggle"><input id="${id}" type="checkbox">${label}</label>`;
  return `<label class="field${type === 'range' ? ' slider' : ''}" for="${id}">${label}${type === 'range' ? `<output id="${id}-value"></output>` : ''}<input id="${id}" type="${type}" ${type === 'range' ? `min="${min}" max="${max}" step="1"` : type === 'text' ? `maxlength="${min}"` : ''}></label>`;
}
function introAssetMarkup(key) {
  return `<div class="design-assets"><a class="design-asset" id="intro-${key}-asset" download><span class="design-asset-image"><img alt="Intro ${key}"></span><span>${key === 'logo' ? 'Logo' : 'App icon'}</span></a></div><button type="button" id="intro-upload-${key}">Upload ${key}</button><input id="intro-${key}-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>`;
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
  $('#intro-tagline-field').hidden = !design.logoEnabled;
  $('#intro-banner-enabled').checked = design.bannerEnabled;
  $('#intro-banner-fields').hidden = !design.bannerEnabled;
  for (const key of ['logo', 'icon']) {
    const url = design[key + 'Image'] || '/assets/' + key + '.webp';
    const card = $('#intro-' + key + '-asset');
    card.href = url;
    card.querySelector('img').src = url;
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
