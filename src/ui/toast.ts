export function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 3400);
}

export function askConfirm(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const dialog = document.createElement('div');
    dialog.className = 'modal confirm';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const text = document.createElement('p');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'row end';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'btn danger';
    ok.type = 'button';
    ok.textContent = confirmLabel;
    const finish = (value: boolean) => {
      wrap.remove();
      resolve(value);
    };
    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    wrap.addEventListener('click', (event) => {
      if (event.target === wrap) finish(false);
    });
    row.append(cancel, ok);
    dialog.append(text, row);
    wrap.append(dialog);
    document.body.append(wrap);
    ok.focus();
  });
}
