// Languages supported by OpenAI Whisper + GPT translation
export const LANGUAGE_NAMES = {
  af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', ar: 'Arabic', hy: 'Armenian',
  as: 'Assamese', az: 'Azerbaijani', eu: 'Basque', be: 'Belarusian', bn: 'Bengali',
  bs: 'Bosnian', br: 'Breton', bg: 'Bulgarian', my: 'Burmese', ca: 'Catalan',
  zh: 'Chinese', hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch',
  en: 'English', et: 'Estonian', fo: 'Faroese', fi: 'Finnish', fr: 'French',
  gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek', gu: 'Gujarati',
  ht: 'Haitian Creole', ha: 'Hausa', haw: 'Hawaiian', he: 'Hebrew', hi: 'Hindi',
  hu: 'Hungarian', is: 'Icelandic', id: 'Indonesian', it: 'Italian', ja: 'Japanese',
  jw: 'Javanese', kn: 'Kannada', kk: 'Kazakh', km: 'Khmer', ko: 'Korean',
  lo: 'Lao', la: 'Latin', lv: 'Latvian', ln: 'Lingala', lt: 'Lithuanian',
  lb: 'Luxembourgish', mk: 'Macedonian', mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam',
  mt: 'Maltese', mi: 'Maori', mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali',
  no: 'Norwegian', nn: 'Norwegian Nynorsk', oc: 'Occitan', ps: 'Pashto', fa: 'Persian',
  pl: 'Polish', pt: 'Portuguese', pa: 'Punjabi', ro: 'Romanian', ru: 'Russian',
  sa: 'Sanskrit', sr: 'Serbian', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak',
  sl: 'Slovenian', so: 'Somali', es: 'Spanish', su: 'Sundanese', sw: 'Swahili',
  sv: 'Swedish', tl: 'Tagalog', tg: 'Tajik', ta: 'Tamil', tt: 'Tatar', te: 'Telugu',
  th: 'Thai', bo: 'Tibetan', tr: 'Turkish', tk: 'Turkmen', uk: 'Ukrainian',
  ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', yi: 'Yiddish', yo: 'Yoruba',
  ba: 'Bashkir', sn: 'Shona',
};

export const DEFAULT_LANG1 = 'en';
export const DEFAULT_LANG2 = 'zh';

export function getLanguagesList() {
  return Object.entries(LANGUAGE_NAMES)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => ({ code, name }));
}
