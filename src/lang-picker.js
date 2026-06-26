const MIN_QUERY_LENGTH = 2;

export function createLangPicker(container, { languages, value, onChange, placeholder = 'Language' }) {
  let selectedCode = value || '';

  const root = document.createElement('div');
  root.className = 'lang-picker';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'lang-picker-input-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lang-picker-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;

  const list = document.createElement('ul');
  list.className = 'lang-picker-list';
  list.hidden = true;

  inputWrap.append(input);
  root.append(inputWrap, list);
  container.appendChild(root);

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
      .map(
        (l) => `
      <li class="lang-picker-option${l.code === selectedCode ? ' selected' : ''}" data-code="${l.code}" role="option">
        <span class="lang-picker-name">${l.name}</span>
      </li>`,
      )
      .join('');
    list.hidden = items.length === 0;
  }

  function showSelectedDisplay() {
    const lang = findLang(selectedCode);
    input.value = lang ? lang.name : '';
    input.placeholder = lang ? '' : placeholder;
    list.hidden = true;
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
    const lang = findLang(selectedCode);
    if (lang && input.value === lang.name) {
      input.select();
    }
    renderList();
  });

  input.addEventListener('input', () => {
    renderList();
  });

  input.addEventListener('keydown', (e) => {
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
