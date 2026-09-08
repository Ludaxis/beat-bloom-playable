import { encodeShare } from './share-codec.js';
const button = document.querySelector('#share-playable'),
  dialog = document.querySelector('#share-dialog'),
  link = document.querySelector('#share-link'),
  status = document.querySelector('#share-status');
button.onclick = async () => {
  const current = api();
  if (!current?.snapshot().ready) {
    message('Still loading. Try again in a moment.');
    return;
  }
  button.disabled = true;
  try {
    const snapshot = { version: 1, profile, level: current.getLevel() },
      fragment = await encodeShare(snapshot);
    link.value = new URL('/play', location.origin).href + '#' + fragment;
    status.textContent = ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
      ? 'Local link. Use the live Studio to share with others.'
      : 'A copy of this level. Later edits won’t change it.';
    dialog.showModal();
    try {
      await navigator.clipboard.writeText(link.value);
      document.querySelector('#share-copy').textContent = 'Copied';
    } catch {
      document.querySelector('#share-copy').textContent = 'Copy link';
    }
    link.focus();
    link.select();
  } catch (error) {
    message('Unable to share: ' + error.message);
  } finally {
    button.disabled = false;
  }
};
document.querySelector('#share-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    document.querySelector('#share-copy').textContent = 'Copied';
  } catch {
    link.focus();
    link.select();
    status.textContent = 'Select and copy the link.';
  }
};
document.querySelector('#share-close').onclick = () => dialog.close();
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
