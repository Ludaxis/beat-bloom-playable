import { encodeShare } from './share-codec.js';
const button = document.querySelector('#share-playable'),
  dialog = document.querySelector('#share-dialog'),
  link = document.querySelector('#share-link'),
  status = document.querySelector('#share-status');
button.onclick = async () => {
  const current = api();
  if (!current?.snapshot().ready) {
    message('Wait for the playable to finish loading.');
    return;
  }
  button.disabled = true;
  try {
    const snapshot = { version: 1, profile, level: current.getLevel() },
      fragment = await encodeShare(snapshot);
    link.value = new URL('/review/shared.html', location.origin).href + '#' + fragment;
    status.textContent = ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
      ? 'Local link: deploy the project before sharing with other devices. Create a new link on your deployed site.'
      : 'This link includes a snapshot of your current playable. Later edits won’t change it.';
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
    status.textContent = 'Copy the selected link with your browser’s Copy command.';
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
