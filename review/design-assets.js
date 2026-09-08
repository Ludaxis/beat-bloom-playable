function refreshDesignAssets(design) {
  for (const [i, key] of ['logo', 'icon'].entries()) {
    const card = document.querySelectorAll('.design-asset')[i],
      url = design[key + 'Image'] || `/assets/${key}.webp`;
    card.href = url;
    card.querySelector('img').src = url;
    card.querySelector('img').alt = `${design[key + 'Image'] ? 'Uploaded' : 'Original'} ${key}`;
  }
}
let assetUploadRevision = 0;
for (const key of ['logo', 'icon']) {
  $(`#upload-${key}`).onclick = () => $(`#${key}-file`).click();
  $(`#${key}-file`).onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++assetUploadRevision,
      a = api(),
      original = a?.getLevel();
    if (!original) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10000000)
        throw Error('Choose a PNG, JPG or WebP under 10 MB.');
      $('#design-status').textContent = 'Preparing image…';
      const bitmap = await createImageBitmap(file);
      let url;
      try {
        if (bitmap.width * bitmap.height > 40000000)
          throw Error('Choose an image smaller than 40 megapixels.');
        for (const limit of [768, 512, 384, 256]) {
          const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height)),
            canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          url = canvas.toDataURL('image/webp', 0.82);
          if (url.length <= 106000) break;
        }
      } finally {
        bitmap.close();
      }
      if (revision !== assetUploadRevision) return;
      if (api() !== a || JSON.stringify(a.getLevel()) !== JSON.stringify(original))
        throw Error('The level changed while preparing the image. Upload it again.');
      a.setEndCardDesign({ [key + 'Image']: url });
      $('#level-json').value = JSON.stringify(a.getLevel(), null, 2);
      refreshDesignAssets(a.getEndCardDesign());
      $('#design-status').textContent = `${key === 'logo' ? 'Logo' : 'Icon'} updated.`;
    } catch (error) {
      $('#design-status').textContent = 'Image not changed: ' + error.message;
    }
  };
}
