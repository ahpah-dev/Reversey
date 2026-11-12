export function openTarget(p) {
  location.hash = `#/target?path=${encodeURIComponent(p)}`;
}

export async function openTargetDialog(kind = 'any') {
  const [p] = await window.reversey.dialog.open({ kind, title: 'Choose a file or folder to analyze' });
  if (p) openTarget(p);
}

// Form fields can claim dropped files: while a drag hovers one, drops go to it
// instead of opening the "analyze target" page.
let activeDropField = null;
export const getActiveDropField = () => activeDropField;

export function claimDrops(el, onPaths) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    activeDropField = { onPaths };
    el.classList.add('drop-over');
  });
  el.addEventListener('dragleave', () => {
    if (activeDropField?.onPaths === onPaths) activeDropField = null;
    el.classList.remove('drop-over');
  });
  el.addEventListener('drop', () => el.classList.remove('drop-over'));
}
