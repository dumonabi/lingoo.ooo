import { createTypingCaret, measureCharCell, positionBlockCaret } from './caret-style.js';

const MIN_QUERY_LENGTH = 2;

const langPickerRegistry = [];

export function hideAllLangPickerCarets() {
  for (const entry of langPickerRegistry) {
    entry.hideCaret();
  }
}

export function createLangPicker(container, {
  languages,
  value,
  onChange,
  placeholder = '',
  onFocusEdit,
} = {}) {
  let selectedCode = value || '';

  const root = document.createElement('div');
  root.className = 'lang-picker';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'lang-picker-input-wrap';

  const field = document.createElement('div');
  field.className = 'lang-picker-field';

  const selectedRow = document.createElement('div');
  selectedRow.className = 'lang-picker-selected-row';
  selectedRow.setAttribute('aria-hidden', 'true');

  const selectedName = document.createElement('span');
  selectedName.className = 'lang-picker-selected-name';

  selectedRow.append(selectedName);

  const mirror = document.createElement('div');
  mirror.className = 'compose-caret-mirror lang-picker-caret-mirror';
  mirror.setAttribute('aria-hidden', 'true');

  const caret = document.createElement('span');
  caret.className = 'compose-caret lang-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lang-picker-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;

  const list = document.createElement('ul');
  list.className = 'lang-picker-list';
  list.hidden = true;

  field.append(selectedRow, mirror, caret, input);
  inputWrap.append(field);
  root.append(inputWrap, list);
  container.appendChild(root);

  const entry = {
    hideCaret() {
      caret.hidden = true;
      inputWrap.classList.remove('is-editing');
      field.classList.remove('is-editing');
    },
  };
  langPickerRegistry.push(entry);
  const typingCaret = createTypingCaret(caret);

  function pulseTypingCaret() {
    typingCaret.pulse();
  }

  function findLang(code) {
    return languages.find((l) => l.code === code);
  }

  function filteredLanguages() {
    const q = input.value.trim().toLowerCase();
    if (q.length < MIN_QUERY_LENGTH) return [];
    return languages.filter((l) => l.name.toLowerCase().startsWith(q));
  }

  function renderList() {
    const items = filteredLanguages();
    list.innerHTML = items
      .map((l) => `
      <li class="lang-picker-option${l.code === selectedCode ? ' selected' : ''}" data-code="${l.code}" role="option">
        <span class="lang-picker-name">${l.name}</span>
      </li>`)
      .join('');
    list.hidden = items.length === 0;
  }

  function syncSelectedRow() {
    const lang = findLang(selectedCode);
    selectedName.textContent = lang?.name || '';
  }

  function syncCaret() {
    const focused = document.activeElement === input;
    inputWrap.classList.toggle('is-editing', focused);
    field.classList.toggle('is-editing', focused);
    inputWrap.classList.toggle('is-empty', !input.value);
    syncSelectedRow();

    if (!focused) {
      caret.hidden = true;
      typingCaret.reset();
      return;
    }

    caret.hidden = false;

    const style = getComputedStyle(input);
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.font = style.font;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.textAlign = style.textAlign;
    mirror.style.padding = '0';
    mirror.style.border = 'none';
    mirror.style.boxSizing = style.boxSizing;

    const caretPos = input.selectionStart ?? input.value.length;
    const textBefore = input.value.slice(0, caretPos);
    const textAfter = input.value.slice(caretPos);

    mirror.replaceChildren();
    mirror.append(document.createTextNode(textBefore));
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker);
    if (textAfter) mirror.append(document.createTextNode(textAfter));

    const markerRect = marker.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const { charWidth, lineHeight } = measureCharCell(mirror, style);

    positionBlockCaret(caret, {
      left: markerRect.left - fieldRect.left,
      top: markerRect.top - fieldRect.top,
      charWidth,
      lineHeight,
    });
  }

  function showSelectedDisplay() {
    const lang = findLang(selectedCode);
    input.value = lang ? lang.name : '';
    input.placeholder = lang ? '' : placeholder;
    inputWrap.classList.remove('is-editing');
    field.classList.remove('is-editing');
    list.hidden = true;
    syncCaret();
  }

  function beginEditing() {
    hideAllLangPickerCarets();
    onFocusEdit?.();
    input.value = '';
    input.placeholder = '';
    list.hidden = true;
    requestAnimationFrame(() => {
      input.setSelectionRange(0, 0);
      syncCaret();
    });
  }

  function select(code) {
    if (!code) return;
    if (code !== selectedCode) {
      selectedCode = code;
      onChange(code);
    }
    showSelectedDisplay();
    input.blur();
  }

  input.addEventListener('focus', () => {
    beginEditing();
  });

  input.addEventListener('input', () => {
    renderList();
    pulseTypingCaret();
    syncCaret();
  });

  input.addEventListener('keydown', (e) => {
    pulseTypingCaret();
    const options = [...list.querySelectorAll('.lang-picker-option')];
    if (e.key === 'Escape') {
      showSelectedDisplay();
      input.blur();
    } else if (e.key === 'Enter' && options.length) {
      e.preventDefault();
      select(options[0].dataset.code);
    } else if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      options[0].focus();
    }
  });

  input.addEventListener('keyup', () => {
    pulseTypingCaret();
    syncCaret();
  });
  input.addEventListener('click', () => {
    pulseTypingCaret();
    syncCaret();
  });
  input.addEventListener('select', syncCaret);

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) {
        showSelectedDisplay();
      }
    }, 120);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.lang-picker-option');
    if (opt) select(opt.dataset.code);
  });

  function setValue(code) {
    selectedCode = code || '';
    showSelectedDisplay();
  }

  showSelectedDisplay();

  return { setValue, getValue: () => selectedCode };
}
