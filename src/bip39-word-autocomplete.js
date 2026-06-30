import { wordlist } from '@scure/bip39/wordlists/english.js';

const MIN_QUERY_LENGTH = 3;

function getCurrentWord(textarea) {
  const value = textarea.value;
  const pos = textarea.selectionStart ?? value.length;
  const before = value.slice(0, pos);
  const wordStart = Math.max(before.lastIndexOf(' ') + 1, before.lastIndexOf('\n') + 1);
  const fragment = before.slice(wordStart).toLowerCase();
  return { value, pos, wordStart, fragment, after: value.slice(pos) };
}

function filteredWords(fragment) {
  if (fragment.length < MIN_QUERY_LENGTH) return [];
  return wordlist.filter((word) => word.startsWith(fragment));
}

function replaceCurrentWord(textarea, word) {
  const { value, wordStart, after } = getCurrentWord(textarea);
  const nextValue = `${value.slice(0, wordStart)}${word} ${after.replace(/^\s*/, '')}`;
  textarea.value = nextValue;
  const caret = wordStart + word.length + 1;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function attachBip39WordAutocomplete(textarea, listEl) {
  if (!textarea || !listEl) return () => {};

  function hideList() {
    listEl.hidden = true;
    listEl.innerHTML = '';
  }

  function renderList() {
    const { fragment } = getCurrentWord(textarea);
    const items = filteredWords(fragment);
    listEl.innerHTML = items
      .map((word) => `<li class="auth-word-option" data-word="${word}" role="option">${word}</li>`)
      .join('');
    listEl.hidden = items.length === 0;
  }

  function selectWord(word) {
    if (!word) return;
    replaceCurrentWord(textarea, word);
    hideList();
    textarea.focus();
  }

  textarea.addEventListener('input', renderList);
  textarea.addEventListener('focus', renderList);

  textarea.addEventListener('keydown', (event) => {
    const options = [...listEl.querySelectorAll('.auth-word-option')];
    if (event.key === 'Escape') {
      hideList();
      return;
    }
    if (event.key === 'Enter' && options.length && !listEl.hidden) {
      event.preventDefault();
      selectWord(options[0].dataset.word);
      return;
    }
    if (event.key === 'ArrowDown' && options.length && !listEl.hidden) {
      event.preventDefault();
      options[0].focus();
    }
  });

  textarea.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!listEl.contains(document.activeElement)) hideList();
    }, 120);
  });

  listEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  listEl.addEventListener('click', (event) => {
    const option = event.target.closest('.auth-word-option');
    if (option) selectWord(option.dataset.word);
  });

  return hideList;
}
