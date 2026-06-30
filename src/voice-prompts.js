export const VOICE_SAMPLE_TARGET = 6;

const VOICE_UI = {
  es: {
    profileName: 'Nombre',
    voiceReady: 'Voz lista',
    voiceNotReady: 'Sin voz',
    voiceProfile: 'Voz',
    voiceCopy: 'Graba 6 clips en tu voz natural.',
    samplesRecorded: 'grabadas',
    samplesSaved: 'Audios guardados',
    resetSamples: 'Reiniciar audios',
    needsUpdate: 'Muestras cambiadas — actualiza la voz.',
    elevenlabsMissing: 'Falta ELEVENLABS_API_KEY en .env.',
    readNext: 'Lee',
    readingNow: 'Leyendo',
    recordSample: 'Grabar',
    stopSample: 'Guardar',
    cancelRecording: 'Cancelar',
    createVoice: 'Crear voz',
    updateVoice: 'Actualizar voz',
    creatingVoice: 'Creando…',
    samplesComplete: 'Configurando voz…',
    enoughSamples: 'Listo',
    setupVoice: 'Configurar voz',
    savingSample: 'Guardando…',
    discardRecording: 'Descartar',
    recordingBlocked: 'Ya tienes 6 muestras.',
    voiceSetupFailed: 'Error:',
    deleteSample: 'Eliminar muestra',
    switchUser: 'Cerrar sesión',
    recordAgain: 'Grabar de nuevo',
    confirmRecordAgain: '¿Reemplazar todas las muestras? Grabarás 6 de nuevo.',
    recoveryPhrase: 'Frase de recuperación',
    showRecoveryPhrase: 'Ver seed',
    hideRecoveryPhrase: 'Ocultar seed',
    recoveryPhraseMissing: 'No está guardada en este dispositivo. Usa la frase que anotaste al crear la cuenta.',
    createAccount: 'Crear cuenta',
    createAccountFailed: 'No se pudo crear la cuenta.',
    cloneVoiceLanguagesFootnote: 'Tu voz funciona en',
    showCloneVoiceLanguages: 'Ver idiomas con tu voz',
    hideCloneVoiceLanguages: 'Ocultar idiomas con tu voz',
  },
  th: {
    profileName: 'ชื่อ',
    voiceReady: 'เสียงพร้อม',
    voiceNotReady: 'ยังไม่มีเสียง',
    voiceProfile: 'เสียง',
    voiceCopy: 'บันทึก 6 คลิปด้วยน้ำเสียงตามธรรมชาติ',
    samplesRecorded: 'บันทึกแล้ว',
    samplesSaved: 'เสียงที่บันทึกแล้ว',
    resetSamples: 'รีเซ็ตเสียงที่บันทึก',
    needsUpdate: 'ตัวอย่างเปลี่ยน — อัปเดตเสียง',
    elevenlabsMissing: 'ไม่มี ELEVENLABS_API_KEY ใน .env',
    readNext: 'อ่าน',
    readingNow: 'กำลังอ่าน',
    recordSample: 'บันทึก',
    stopSample: 'บันทึก',
    cancelRecording: 'ยกเลิก',
    createVoice: 'สร้างเสียง',
    updateVoice: 'อัปเดตเสียง',
    creatingVoice: 'กำลังสร้าง…',
    samplesComplete: 'กำลังตั้งค่า…',
    enoughSamples: 'ครบแล้ว',
    setupVoice: 'ตั้งค่าเสียง',
    savingSample: 'กำลังบันทึก…',
    discardRecording: 'ยกเลิก',
    recordingBlocked: 'มีครบ 6 ตัวอย่างแล้ว',
    voiceSetupFailed: 'ผิดพลาด:',
    deleteSample: 'ลบตัวอย่าง',
    switchUser: 'ปิดเซสชัน',
    recordAgain: 'บันทึกใหม่',
    confirmRecordAgain: 'แทนที่ตัวอย่างทั้งหมด? คุณจะบันทึกใหม่ 6 ครั้ง',
    recoveryPhrase: 'วลีกู้คืน',
    showRecoveryPhrase: 'Show seed',
    hideRecoveryPhrase: 'Hide seed',
    recoveryPhraseMissing: 'ไม่ได้บันทึกไว้ในอุปกรณ์นี้ ใช้วลีที่คุณบันทึกตอนสร้างบัญชี',
    createAccount: 'Create account',
    createAccountFailed: 'Could not create account.',
    cloneVoiceLanguagesFootnote: 'เสียงของคุณใช้ได้ใน',
    showCloneVoiceLanguages: 'Show voice languages',
    hideCloneVoiceLanguages: 'Hide voice languages',
  },
  en: {
    profileName: 'Name',
    voiceReady: 'Voice ready',
    voiceNotReady: 'No voice yet',
    voiceProfile: 'Voice',
    voiceCopy: 'Record 6 short clips in your natural voice.',
    samplesRecorded: 'recorded',
    samplesSaved: 'Saved recordings',
    resetSamples: 'Reset recordings',
    needsUpdate: 'Samples changed — update voice.',
    elevenlabsMissing: 'Missing ELEVENLABS_API_KEY in .env.',
    readNext: 'Read',
    readingNow: 'Reading',
    recordSample: 'Record',
    stopSample: 'Save',
    cancelRecording: 'Cancel',
    createVoice: 'Create voice',
    updateVoice: 'Update voice',
    creatingVoice: 'Creating…',
    samplesComplete: 'Setting up voice…',
    enoughSamples: 'Done',
    setupVoice: 'Set up voice',
    savingSample: 'Saving…',
    discardRecording: 'Discard',
    recordingBlocked: '6 samples full.',
    voiceSetupFailed: 'Error:',
    deleteSample: 'Delete sample',
    switchUser: 'Close session',
    recordAgain: 'Record again',
    confirmRecordAgain: 'Replace all samples? You’ll record 6 again.',
    recoveryPhrase: 'Recovery phrase',
    showRecoveryPhrase: 'Show seed',
    hideRecoveryPhrase: 'Hide seed',
    recoveryPhraseMissing: 'Not saved on this device. Use the phrase you wrote down when you created your account.',
    createAccount: 'Create account',
    createAccountFailed: 'Could not create account.',
    cloneVoiceLanguagesFootnote: 'Your voice works in',
    showCloneVoiceLanguages: 'Show voice languages',
    hideCloneVoiceLanguages: 'Hide voice languages',
  },
};

const VOICE_PROMPTS = {
  es: [
    'Hola, esta es mi voz. Estoy grabando esta muestra para mi perfil personal en Lingu.ooo.',
    '¿Cómo estás hoy? Me gusta hablar con naturalidad, como lo haría con un amigo.',
    '¡Qué bien! Esto suena emocionante, y quiero que se note la energía en mi voz.',
    'A veces explico las cosas con calma: hablo despacio, con claridad, y dejo pausas naturales entre frases.',
    '¿De verdad crees que la entonación cambia tanto cuando hacemos una pregunta?',
    'Cuando leo un mensaje más largo, mantengo el mismo tono de siempre, como si estuviera contándoselo a alguien que conozco bien.',
  ],
  th: [
    'สวัสดี นี่คือเสียงของฉัน ฉันกำลังบันทึกตัวอย่างนี้เพื่อสร้างโปรไฟล์เสียงส่วนตัวใน Lingu.ooo',
    'วันนี้เป็นอย่างไรบ้าง ฉันชอบพูดอย่างเป็นธรรมชาติ เหมือนคุยกับเพื่อนสนิท',
    'เยี่ยมมาก นี่ฟังดูน่าตื่นเต้น และฉันอยากให้พลังงานในคำพูดของฉันออกมาชัดเจน',
    'บางครั้งฉันอธิบายอย่างใจเย็น พูดช้า ชัดเจน และหยุดพักตามจังหวะธรรมชาติ',
    'คุณคิดจริง ๆ ว่าน้ำเสียงเปลี่ยนมากเมื่อเราถามคำถามหรือเปล่า',
    'เมื่อฉันอ่านข้อความที่ยาวขึ้น ฉันยังคงใช้โทนเดิม เหมือนเล่าให้คนที่รู้จักดีฟัง',
  ],
  en: [
    'Hello, this is my voice. I am recording this sample for my personal profile on Lingu.ooo.',
    'How are you today? I like to speak naturally, just like I would with a close friend.',
    'That is great! This sounds exciting, and I want my energy to come through in my voice.',
    'Sometimes I explain things calmly: I speak slowly, clearly, and leave natural pauses between phrases.',
    'Do you really think intonation changes this much when we ask a question?',
    'When I read a longer message, I keep the same everyday tone, as if I were telling someone I know well.',
  ],
};

export function resolveVoiceLanguage(code) {
  const lang = String(code || 'en').toLowerCase().trim();
  if (VOICE_PROMPTS[lang]) return lang;
  return 'en';
}

export function getVoiceUi(code) {
  const lang = resolveVoiceLanguage(code);
  return VOICE_UI[lang];
}

export function getVoicePrompts(code) {
  const lang = resolveVoiceLanguage(code);
  return VOICE_PROMPTS[lang];
}

export function getVoicePrompt(code, sampleCount) {
  const prompts = getVoicePrompts(code);
  return prompts[sampleCount % prompts.length];
}
