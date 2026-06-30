export const CARET_TYPING_IDLE_MS = 700;

export function measureCharCell(mirror, style) {
  const probe = document.createElement('span');
  probe.textContent = 'M';
  probe.setAttribute('aria-hidden', 'true');
  mirror.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const lineHeight = parseFloat(style.lineHeight) || rect.height || parseFloat(style.fontSize) * 1.45;
  const charWidth = rect.width || parseFloat(style.fontSize) * 0.58;

  return { charWidth, lineHeight };
}

export function positionBlockCaret(caret, { left, top, charWidth, lineHeight }) {
  const blockHeight = Math.max(lineHeight * 0.88, 12);
  const blockWidth = charWidth * 0.75;
  const insetY = Math.max(0, (lineHeight - blockHeight) / 2);

  caret.style.left = `${left}px`;
  caret.style.top = `${top + insetY}px`;
  caret.style.width = `${blockWidth}px`;
  caret.style.height = `${blockHeight}px`;
}

export function createTypingCaret(caretEl) {
  let idleTimer = null;

  return {
    pulse() {
      if (!caretEl) return;
      caretEl.classList.add('is-typing');
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        caretEl.classList.remove('is-typing');
      }, CARET_TYPING_IDLE_MS);
    },
    reset() {
      clearTimeout(idleTimer);
      idleTimer = null;
      caretEl?.classList.remove('is-typing');
    },
  };
}
