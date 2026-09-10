/** Screen ratios are an editor preference; resizing never restarts gameplay or changes exports. */
function mountPreviewSizes(column, surface, storageKey) {
  const sizes = [
    { id: 'phone', label: 'Phone · 9:16', width: 9, height: 16 },
    { id: 'tall', label: 'Tall phone · 9:19.5', width: 9, height: 19.5 },
    { id: 'tablet', label: 'Tablet · 3:4', width: 3, height: 4 },
    { id: 'square', label: 'Square · 1:1', width: 1, height: 1 },
    { id: 'landscape', label: 'Landscape · 16:9', width: 16, height: 9 },
  ];
  let selected = 'phone',
    rotated = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (sizes.some((size) => size.id === saved?.id)) {
      selected = saved.id;
      rotated = saved.rotated === true;
    }
  } catch {
    /* Storage may be unavailable in a private window. */
  }
  const controls = document.createElement('div');
  controls.className = 'preview-size-controls';
  controls.innerHTML = `<label>Screen<select aria-label="Preview screen" id="preview-screen">${sizes.map((size) => `<option value="${size.id}">${size.label}</option>`).join('')}</select></label><button type="button" aria-label="Rotate preview" title="Rotate preview"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="10" height="14" rx="2"/><path d="M3 9a9 9 0 0 1 15-6m0 0h-4m4 0v4M21 15a9 9 0 0 1-15 6m0 0h4m-4 0v-4"/></svg></button>`;
  column.querySelector('.preview-heading, .view-label').after(controls);
  const select = controls.querySelector('select'),
    rotate = controls.querySelector('button');
  select.value = selected;
  function fit() {
    const size = sizes.find((size) => size.id === selected);
    const width = rotated ? size.height : size.width,
      height = rotated ? size.width : size.height;
    const style = getComputedStyle(column);
    const available =
      column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (available <= 0) return;
    const siblings = Array.from(column.children).filter(
      (child) => child !== surface && !child.contains(surface),
    );
    const chrome = siblings.reduce((sum, child) => {
      const css = getComputedStyle(child);
      if (css.display === 'none') return sum;
      return (
        sum +
        child.getBoundingClientRect().height +
        parseFloat(css.marginTop) +
        parseFloat(css.marginBottom)
      );
    }, 0);
    const footer = document.querySelector('.partner-footer')?.getBoundingClientRect().height || 40;
    const top = window.innerWidth > 850 ? column.getBoundingClientRect().top : 140;
    const budget =
      window.innerHeight -
      top -
      footer -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom) -
      chrome -
      12;
    const previewHeight = Math.min(
      700,
      window.innerWidth <= 850 ? 700 : Math.max(300, budget),
      (available * height) / width,
    );
    for (const option of Array.from(select.options)) {
      const preset = sizes.find((size) => size.id === option.value);
      if (!preset) continue;
      option.textContent =
        option.value === selected && rotated
          ? `${preset.label.split(' · ')[0]} · ${preset.height}:${preset.width}`
          : preset.label;
    }
    surface.style.width = `${(previewHeight * width) / height}px`;
    surface.style.height = `${previewHeight}px`;
    surface.style.aspectRatio = `${width} / ${height}`;
    surface.style.maxWidth = '100%';
    surface.style.maxHeight = 'none';
    surface.style.flex = 'none';
    surface.dataset.screen = selected;
    surface.dataset.ratio = String(width / height);
    rotate.setAttribute('aria-pressed', String(rotated));
    rotate.disabled = size.width === size.height;
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ id: selected, rotated }));
    } catch {
      /* Keep working without persistence. */
    }
    fit();
  }
  select.addEventListener('change', () => {
    selected = select.value;
    rotated = false;
    save();
  });
  rotate.addEventListener('click', () => {
    rotated = !rotated;
    save();
  });
  const observer = new ResizeObserver(fit);
  observer.observe(column);
  window.addEventListener('resize', fit);
  fit();
}

mountPreviewSizes(
  document.querySelector('.workspace'),
  document.querySelector('.phone'),
  'beatbloom-preview-screen-v1',
);
