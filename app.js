import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const topicInput = document.getElementById('topic');
const generateBtn = document.getElementById('generate-all');
const clearBtn = document.getElementById('clear');
const modelSelect = document.getElementById('model-select');
const themeSelect = document.getElementById('theme-select');
const briefIdeaInput = document.getElementById('brief-idea');
const briefAiBtn = document.getElementById('brief-ai');
const briefStatus = document.getElementById('brief-status');

const chatSendBtn = document.getElementById('chat-send');
const chatHistoryBox = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const loadingIndicator = document.getElementById('loading-indicator');
const chatImageInput = document.getElementById('chat-image');
const voiceToggleBtn = document.getElementById('voice-toggle');
const voiceStatus = document.getElementById('voice-status');

const authOpenBtn = document.getElementById('auth-open');
const authLogoutBtn = document.getElementById('auth-logout');
const authStatus = document.getElementById('auth-status');
const authModal = document.getElementById('auth-modal');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authLoginBtn = document.getElementById('auth-login');
const authSignupBtn = document.getElementById('auth-signup');
const authMessage = document.getElementById('auth-message');
const authGuest = document.getElementById('auth-guest');
const authLogged = document.getElementById('auth-logged');
const profileEmail = document.getElementById('profile-email');
const profileNameInput = document.getElementById('profile-name');
const profileSaveBtn = document.getElementById('profile-save');
const profileMessage = document.getElementById('profile-message');
const authCloseEls = document.querySelectorAll('[data-auth-close]');

const STORAGE_KEY = 'bloggergpt.messages.v3';
const THEME_KEY = 'bloggergpt.theme';
let messages = loadMessages();
let typingTimer = null;
let chatImageDataUrl = '';
let speechRecognition = null;
let speechEnabled = false;
let supabase = null;
let currentUser = null;
let currentChatId = null;
let profileName = '';


function applyTheme(value) {
  const theme = value || 'aurora';
  document.body.dataset.theme = theme;
  if (themeSelect) themeSelect.value = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
}

const savedTheme = (() => {
  try {
    return localStorage.getItem(THEME_KEY) || 'aurora';
  } catch (_) {
    return 'aurora';
  }
})();
applyTheme(savedTheme);

themeSelect?.addEventListener('change', () => {
  applyTheme(themeSelect.value);
});

function setAuthMessage(text) {
  if (authMessage) authMessage.textContent = text || '';
}

function setProfileMessage(text) {
  if (profileMessage) profileMessage.textContent = text || '';
}

function openAuthModal() {
  if (!authModal) return;
  authModal.classList.add('show');
  authModal.setAttribute('aria-hidden', 'false');
  setAuthMessage('');
  setProfileMessage('');
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.remove('show');
  authModal.setAttribute('aria-hidden', 'true');
}

function setAuthUI() {
  if (!authStatus) return;
  if (!supabase) {
    authStatus.textContent = 'Локальный режим';
    authOpenBtn?.setAttribute('hidden', '');
    authLogoutBtn?.setAttribute('hidden', '');
    authGuest?.setAttribute('hidden', '');
    authLogged?.setAttribute('hidden', '');
    return;
  }
  if (currentUser) {
    const label = profileName || currentUser.email || 'Пользователь';
    authStatus.textContent = label;
    authOpenBtn?.removeAttribute('hidden');
    authOpenBtn.textContent = 'Профиль';
    authLogoutBtn?.removeAttribute('hidden');
    authGuest?.setAttribute('hidden', '');
    authLogged?.removeAttribute('hidden');
    if (profileEmail) profileEmail.textContent = currentUser.email || '';
    if (profileNameInput) profileNameInput.value = profileName;
  } else {
    authStatus.textContent = 'Гость';
    authOpenBtn?.removeAttribute('hidden');
    authOpenBtn.textContent = 'Войти';
    authLogoutBtn?.setAttribute('hidden', '');
    authGuest?.removeAttribute('hidden');
    authLogged?.setAttribute('hidden', '');
  }
}

function loadLocalMessages() {
  messages = loadMessages();
  renderMessages();
}

async function createNewChat() {
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: currentUser.id, title: 'Новый чат' })
    .select('id')
    .single();
  if (!error && data?.id) {
    currentChatId = data.id;
  }
}

async function loadProfile() {
  if (!supabase || !currentUser) return;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', currentUser.id)
      .single();
    profileName = data?.display_name || '';
    if (profileNameInput) profileNameInput.value = profileName;
  } catch (_) {
    profileName = '';
  }
  setAuthUI();
}

async function saveProfile() {
  if (!supabase || !currentUser) return;
  const name = (profileNameInput?.value || '').trim();
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: currentUser.id, display_name: name });
  if (error) {
    return;
  }
  profileName = name;
  setAuthUI();
}

async function loadRemoteChat() {
  if (!supabase || !currentUser) return;
  const { data: chats } = await supabase
    .from('chats')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!chats || chats.length === 0) {
    await createNewChat();
  } else {
    currentChatId = chats[0].id;
  }
  if (!currentChatId) {
    messages = [];
    renderMessages();
    return;
  }
  const { data: rows } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('chat_id', currentChatId)
    .order('created_at', { ascending: true });
  messages = (rows || []).map((row) => ({
    role: row.role,
    content: row.content,
    ts: new Date(row.created_at).getTime()
  }));
  renderMessages();
}

async function persistMessageRemote(msg) {
  if (!supabase || !currentUser || !currentChatId) return;
  await supabase.from('messages').insert({
    chat_id: currentChatId,
    user_id: currentUser.id,
    role: msg.role,
    content: msg.content
  });
}

async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
      setAuthUI();
      return;
    }
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    currentUser = data?.session?.user || null;
    setAuthUI();
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      profileName = '';
      if (currentUser) {
        loadProfile().catch(() => {});
        loadRemoteChat();
      } else {
        loadLocalMessages();
      }
      setAuthUI();
    });
    if (currentUser) {
      await loadProfile();
      await loadRemoteChat();
    } else {
      loadLocalMessages();
    }
  } catch (_) {
    setAuthUI();
  }
}

authOpenBtn?.addEventListener('click', () => {
  if (!supabase) return;
  openAuthModal();
});

authCloseEls?.forEach((btn) => {
  btn.addEventListener('click', closeAuthModal);
});

authLoginBtn?.addEventListener('click', async () => {
  if (!supabase) return;
  const email = authEmail?.value?.trim();
  const password = authPassword?.value || '';
  if (!email || !password) {
    setAuthMessage('Введите email и пароль');
    return;
  }
  setAuthMessage('Входим...');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthMessage('Ошибка входа: ' + error.message);
    return;
  }
  closeAuthModal();
});

profileSaveBtn?.addEventListener('click', saveProfile);

authSignupBtn?.addEventListener('click', async () => {
  if (!supabase) return;
  const email = authEmail?.value?.trim();
  const password = authPassword?.value || '';
  if (!email || !password) {
    setAuthMessage('Введите email и пароль');
    return;
  }
  setAuthMessage('Создаём аккаунт...');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthMessage('Ошибка регистрации: ' + error.message);
    return;
  }
  if (!data?.session) {
    setAuthMessage('Проверьте почту и подтвердите регистрацию');
  } else {
    closeAuthModal();
  }
});

authLogoutBtn?.addEventListener('click', async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
});

const state = {
  topic: '',
  tone: 'дружелюбный',
  length: 'коротко',
  format: 'пост'
};

function chooseChip(groupId) {
  document.getElementById(groupId).addEventListener('click', (e) => {
    if (!e.target.dataset.value) return;
    [...e.currentTarget.children].forEach((c) => c.classList.remove('active'));
    e.target.classList.add('active');
    state[groupId] = e.target.dataset.value;
  });
}

['tone', 'length', 'format'].forEach(chooseChip);

generateBtn.addEventListener('click', () => {
  state.topic = topicInput.value.trim() || 'Создание блога с нуля';
  renderTitles();
  renderOutline();
  renderHook();
  renderKeywords();
  renderCTA();
});

clearBtn.addEventListener('click', async () => {
  if (currentUser && supabase) {
    await createNewChat();
    messages = [];
    renderMessages();
    return;
  }
  messages = [];
  saveMessages();
  renderMessages();
  chatInput.value = '';
});

briefAiBtn?.addEventListener('click', () => {
  fillBriefWithAI();
});

document.querySelectorAll('[data-prompt]').forEach((btn) => {
  btn.addEventListener('click', () => {
    chatInput.value = btn.dataset.prompt;
    chatInput.focus();
  });
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

chatSendBtn.addEventListener('click', sendChat);

function setLoading(flag) {
  loadingIndicator.classList.toggle('show', flag);
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages() {
  if (currentUser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function pushMessage(role, content, persist = true) {
  const msg = { role, content, ts: Date.now() };
  messages.push(msg);
  saveMessages();
  renderMessages();
  if (persist) {
    persistMessageRemote(msg).catch(() => {});
  }
  return msg;
}

function renderMessages() {
  chatHistoryBox.innerHTML = '';
  messages.forEach((m) => {
    const row = document.createElement('div');
    row.className = `message ${m.role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${m.role === 'assistant' ? 'ai' : ''}`;
    avatar.textContent = m.role === 'assistant' ? 'AI' : 'You';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.content;

    if (m.role === 'user') {
      row.appendChild(bubble);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
    }
    chatHistoryBox.appendChild(row);
  });
  scrollToBottom();
}

function scrollToBottom() {
  chatHistoryBox.scrollTop = chatHistoryBox.scrollHeight;
}

function getResetAt(data, response) {
  if (data?.reset_at) {
    const dt = new Date(data.reset_at);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const header = response?.headers?.get?.('X-RateLimit-Reset');
  if (header) {
    const ts = Number(header);
    if (!Number.isNaN(ts)) return new Date(ts * 1000);
  }
  return null;
}

function formatRateLimitMessage(data, response) {
  const resetAt = getResetAt(data, response);
  if (resetAt) {
    const now = new Date();
    const time = resetAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const date = resetAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const withDate = resetAt.toDateString() !== now.toDateString();
    return `Лимит запросов. Доступно после ${time}${withDate ? ` ${date}` : ''}.`;
  }
  const retry = Number(data?.retry_after_sec);
  if (!Number.isNaN(retry) && retry > 0) {
    const mins = Math.max(1, Math.ceil(retry / 60));
    return `Лимит запросов. Доступно через ${mins} мин.`;
  }
  return 'Лимит запросов. Попробуйте позже.';
}

function buildErrorMessage(status, data, response) {
  if (status === 429) return formatRateLimitMessage(data, response);
  const detail = data?.detail || data?.error;
  return `Ошибка ${status}: ${detail || 'нет данных'}`;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text && !chatImageDataUrl) return;

  pushMessage('user', text || 'Отправлено изображение');
  chatInput.value = '';
  setLoading(true);

  const assistantMsg = pushMessage('assistant', '', false);

  try {
    const payload = buildMessages(text);
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: payload
      })
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      assistantMsg.content = buildErrorMessage(res.status, data, res);
      saveMessages();
      renderMessages();
      setLoading(false);
      return;
    }
    const reply = data?.reply?.content || '';
    typeText(assistantMsg, reply);
  } catch (err) {
    const raw = String(err?.message || err || '');
    const isNetwork = /fetch|network|failed/i.test(raw);
    assistantMsg.content = isNetwork
      ? 'Нет соединения. Проверьте интернет и попробуйте снова.'
      : 'Ошибка: ' + raw;
    saveMessages();
    renderMessages();
    setLoading(false);
  }
}

function buildMessages(text) {
  const system = 'Ты универсальный AI-ассистент. Отвечай понятно и по делу.';
  const history = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (chatImageDataUrl) {
    const imageContent = [
      { type: 'text', text: text || 'Опиши изображение и ответь на вопрос.' },
      { type: 'image_url', image_url: { url: chatImageDataUrl } }
    ];
    chatImageDataUrl = '';
    return [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: imageContent }
    ];
  }

  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: text }
  ];
}

async function fillBriefWithAI() {
  const seed = (briefIdeaInput?.value || '').trim() || (topicInput?.value || '').trim();
  if (!seed) {
    briefStatus.textContent = 'Введите короткое описание для AI';
    return;
  }
  briefStatus.textContent = 'BloggerGPT думает...';
  try {
    const system = 'Ты помощник по брифу контента. Верни JSON строго вида {"topic":"","tone":"","length":"","format":""}. tone: дружелюбный|экспертный|провокационный|лаконичный. length: коротко|средне|подробно. format: пост|видео сценарий|подкаст|рассылка.';
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: seed }
        ]
      })
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      briefStatus.textContent = res.status === 429
        ? formatRateLimitMessage(data, res)
        : `Ошибка ${res.status}`;
      return;
    }
    const json = extractJson(data?.reply?.content || '');
    if (!json) {
      briefStatus.textContent = 'Не удалось распознать ответ';
      return;
    }
    applyBrief(json);
    briefStatus.textContent = 'Готово';
  } catch (err) {
    briefStatus.textContent = 'Ошибка запроса';
  }
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

function applyBrief({ topic, tone, length, format }) {
  if (topic) topicInput.value = String(topic).trim();
  if (tone) setGroupValue('tone', normalizeTone(tone));
  if (length) setGroupValue('length', normalizeLength(length));
  if (format) setGroupValue('format', normalizeFormat(format));
}

function setGroupValue(groupId, value) {
  if (!value) return;
  const group = document.getElementById(groupId);
  if (!group) return;
  const buttons = [...group.querySelectorAll('.chip')];
  buttons.forEach((b) => b.classList.remove('active'));
  const target = buttons.find((b) => b.dataset.value === value);
  if (target) {
    target.classList.add('active');
    state[groupId] = value;
  }
}

function normalizeTone(value) {
  const v = String(value).toLowerCase();
  if (v.includes('друж')) return 'дружелюбный';
  if (v.includes('эксперт')) return 'экспертный';
  if (v.includes('провок')) return 'провокационный';
  if (v.includes('лакон')) return 'лаконичный';
  return '';
}

function normalizeLength(value) {
  const v = String(value).toLowerCase();
  if (v.includes('корот')) return 'коротко';
  if (v.includes('сред')) return 'средне';
  if (v.includes('подроб')) return 'подробно';
  return '';
}

function normalizeFormat(value) {
  const v = String(value).toLowerCase();
  if (v.includes('видео')) return 'видео сценарий';
  if (v.includes('подкаст')) return 'подкаст';
  if (v.includes('рассыл')) return 'рассылка';
  if (v.includes('пост')) return 'пост';
  return '';
}

function typeText(message, fullText) {
  clearInterval(typingTimer);
  const text = fullText || 'Нет ответа.';
  let i = 0;
  typingTimer = setInterval(() => {
    message.content = text.slice(0, i);
    renderMessages();
    i += 1;
    if (i > text.length) {
      clearInterval(typingTimer);
      saveMessages();
      persistMessageRemote(message).catch(() => {});
      setLoading(false);
      speakIfEnabled(text);
    }
  }, 12);
}

chatImageInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  chatImageDataUrl = dataUrl;
  pushMessage('assistant', 'Фото прикреплено. Напишите вопрос и отправьте.');
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceStatus.textContent = 'браузер не поддерживает голос';
    voiceToggleBtn.disabled = true;
    return;
  }
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'ru-RU';
  speechRecognition.interimResults = true;
  speechRecognition.continuous = true;
  speechRecognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;
  };
  speechRecognition.onend = () => {
    speechEnabled = false;
    voiceStatus.textContent = 'микрофон выключен';
    voiceToggleBtn.textContent = 'Говорить';
  };
}

voiceToggleBtn?.addEventListener('click', () => {
  if (!speechRecognition) setupSpeech();
  if (!speechRecognition) return;
  if (speechEnabled) {
    speechEnabled = false;
    speechRecognition.stop();
    voiceStatus.textContent = 'микрофон выключен';
    voiceToggleBtn.textContent = 'Говорить';
    return;
  }
  speechEnabled = true;
  voiceStatus.textContent = 'слушаю...';
  voiceToggleBtn.textContent = 'Стоп';
  speechRecognition.start();
});

function speakIfEnabled(text) {
  if (!speechEnabled) return;
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ru-RU';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function renderTitles() {
  const el = document.getElementById('titles');
  el.innerHTML = '';
  const templates = [
    `Как ${state.topic} — гайд ${state.tone}`,
    `${state.topic}: ошибки, которых легко избежать`,
    `${state.topic} за 30 минут в день: план ${state.length}`,
    `Что если ${state.topic}? Реальный разбор для ${state.format}`,
    `${capitalize(state.topic)}: 5 шагов без лишней воды`
  ];
  templates.forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    el.appendChild(li);
  });
}

function renderOutline() {
  const el = document.getElementById('outline');
  el.innerHTML = '';
  const base = [
    'Хук: цифра, боль или выгодный исход',
    'Контекст: почему тема важна сейчас',
    '3–5 ключевых шагов/лайфхаков',
    'Примеры или мини-кейс',
    'Чек-лист для повторения',
    'Призыв: что сделать читателю'
  ];
  base.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.replace('тема', state.topic);
    el.appendChild(li);
  });
}

function renderHook() {
  const el = document.getElementById('hook');
  const hooks = [
    `У тебя есть всего ${state.length === 'коротко' ? '60 секунд' : '5 минут'}, чтобы удержать внимание. Расскажу, как ${state.topic} без лишней воды.`,
    `98% блогеров бросают на втором месяце. ${capitalize(state.topic)} — способ выжить и вырасти, если действовать системно.`,
    `Представь, что твой контент продаёт, даже когда ты спишь. ${capitalize(state.topic)} — первый шаг.`
  ];
  el.textContent = hooks[Math.floor(Math.random() * hooks.length)];
}

function renderKeywords() {
  const el = document.getElementById('keywords');
  el.innerHTML = '';
  const parts = state.topic.split(' ');
  const seeds = parts.slice(0, 3).map((p) => p.toLowerCase());
  const keywords = [...new Set([
    ...seeds,
    `${state.topic} чеклист`,
    `${state.topic} как начать`,
    `${state.topic} советы`,
    `${state.topic} ошибки`,
    `${state.topic} 2026`
  ])];
  keywords.slice(0, 8).forEach((k) => {
    const li = document.createElement('li');
    li.textContent = k;
    el.appendChild(li);
  });
}

function renderCTA() {
  const el = document.getElementById('cta');
  el.innerHTML = '';
  const ctas = [
    'Сохрани чек-лист и вернись после съемки',
    'Подпишись, если нужен разбор твоего аккаунта',
    'Напиши «хочу план» — пришлю личный шаблон',
    'Поставь 🔔, чтобы не пропустить практикум'
  ];
  ctas.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c;
    el.appendChild(li);
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-copy');
    const node = document.getElementById(id);
    let text = '';
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      text = [...node.querySelectorAll('li')].map((li) => li.textContent).join('\n');
    } else {
      text = node.textContent;
    }
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Скопировано';
      setTimeout(() => (btn.textContent = 'Копировать'), 1200);
    });
  });
});

renderMessages();
initSupabase();
generateBtn.click();
