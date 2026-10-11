import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';

const root = document.querySelector('#app');
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const state = {
  appSlug: null,
  apps: [],
  appsLoaded: false,
  content: null,
  editing: null,
  message: null,
  section: 'exam-types',
  session: null,
  questionFilterExamTypeId: '',
  questionFilterThemeId: '',
  questionSearch: '',
};

let loadAppsPromise = null;
let loadContentAppSlug = null;
let loadContentPromise = null;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const secondsToMinutes = (seconds) => Math.round(Number(seconds) / 60);

function formatDateTime(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function parsePositiveInteger(value, label) {
  const token = String(value ?? '').trim();

  if (!/^\d+$/.test(token) || Number.parseInt(token, 10) <= 0) {
    throw new Error(`${label} precisa ser um número inteiro positivo.`);
  }

  return Number.parseInt(token, 10);
}

function parsePositiveIntegerList(value, label, { allowEmpty = false } = {}) {
  const rawValue = String(value ?? '').trim();

  if (!rawValue && allowEmpty) {
    return [];
  }

  const tokens = String(value ?? '').split(',').map((item) => item.trim());
  const invalidTokens = tokens.filter((token) => !/^\d+$/.test(token) || Number.parseInt(token, 10) <= 0);

  if (tokens.length === 0 || invalidTokens.length > 0) {
    const formattedTokens = invalidTokens.map((token) => token || 'vazio').join(', ');
    throw new Error(`${label} contém valores inválidos: ${formattedTokens}. Use números inteiros positivos separados por vírgula.`);
  }

  const values = tokens.map((token) => Number.parseInt(token, 10));

  if (new Set(values).size !== values.length) {
    throw new Error(`${label} não pode ter valores repetidos.`);
  }

  return values;
}
const alternativeLetter = (index) => String.fromCharCode(65 + index);

function validateAlternatives(alternatives, correctAlternativeId) {
  if (alternatives.length < 1) {
    throw new Error('A questão precisa ter pelo menos uma alternativa.');
  }

  if (alternatives.some((alternative) => !String(alternative.text ?? '').trim())) {
    throw new Error('Todas as alternativas precisam ter texto.');
  }

  if (new Set(alternatives.map((alternative) => alternative.id)).size !== alternatives.length) {
    throw new Error('As alternativas não podem ter letras repetidas.');
  }

  if (!alternatives.some((alternative) => alternative.id === correctAlternativeId)) {
    throw new Error('Selecione a alternativa correta.');
  }
}

async function api(path, options = {}) {
  const functionPath = path.replace(/^\//, '');
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;
  const { data, error } = await supabase.functions.invoke(`admin-api/${functionPath}`, {
    method,
    body,
  });

  if (error) {
    let message = error.message ?? 'Erro inesperado na API.';

    if (error.context instanceof Response) {
      const responseText = await error.context.text().catch(() => '');
      try {
        const responseJson = JSON.parse(responseText);
        message = responseJson.error ?? responseJson.message ?? message;
      } catch {
        message = responseText || message;
      }
    }

    throw new Error(message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data ?? {};
}

async function boot() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    const previousUserId = state.session?.user?.id ?? null;
    const nextUserId = session?.user?.id ?? null;
    state.session = session;

    if (previousUserId === nextUserId) {
      if (!state.content && session) loadApps();
      return;
    }

    state.content = null;
    state.apps = [];
    state.appsLoaded = false;
    state.appSlug = null;
    render();
    if (session) loadApps();
  });

  render();
  if (state.session) await loadApps();
}

async function loadApps() {
  if (loadAppsPromise) return loadAppsPromise;

  loadAppsPromise = (async () => {
    try {
      const payload = await api('/apps');
      state.apps = payload.apps ?? [];
      state.appsLoaded = true;
      state.appSlug = state.appSlug ?? state.apps[0]?.slug ?? null;
      if (state.appSlug) await loadContent();
      else render();
    } catch (error) {
      setMessage(error.message, true);
    }
  })().finally(() => {
    loadAppsPromise = null;
  });

  return loadAppsPromise;
}

async function loadContent({ force = false } = {}) {
  if (!state.appSlug) return;

  const appSlug = state.appSlug;

  if (!force && loadContentPromise && loadContentAppSlug === appSlug) {
    return loadContentPromise;
  }

  loadContentAppSlug = appSlug;
  loadContentPromise = (async () => {
    const payload = await api(`/apps/${appSlug}/content`);

    if (state.appSlug !== appSlug) return;

    state.content = payload;
    sanitizeQuestionFilters();
    state.editing = null;
    render();
  })().finally(() => {
    if (loadContentAppSlug === appSlug) {
      loadContentAppSlug = null;
      loadContentPromise = null;
    }
  });

  return loadContentPromise;
}

function sanitizeQuestionFilters() {
  if (!state.content) return;

  const examTypes = state.content.examTypes ?? [];
  const themes = state.content.themes ?? [];
  const selectedExamTypeExists = examTypes.some((examType) => String(examType.id) === String(state.questionFilterExamTypeId));

  if (state.questionFilterExamTypeId && !selectedExamTypeExists) {
    state.questionFilterExamTypeId = '';
    state.questionFilterThemeId = '';
    return;
  }

  if (!state.questionFilterThemeId) return;

  if (!state.questionFilterExamTypeId) {
    state.questionFilterThemeId = '';
    return;
  }

  const selectedTheme = themes.find((theme) => String(theme.id) === String(state.questionFilterThemeId));
  const selectedThemeBelongsToExamType = !state.questionFilterExamTypeId
    || String(selectedTheme?.exam_type_id) === String(state.questionFilterExamTypeId);

  if (!selectedTheme || !selectedThemeBelongsToExamType) {
    state.questionFilterThemeId = '';
  }
}

function setMessage(text, isError = false) {
  state.message = { text, isError };
  render();
}

function resetAuthState() {
  state.session = null;
  state.content = null;
  state.apps = [];
  state.appsLoaded = false;
  state.appSlug = null;
  state.message = null;
  state.editing = null;
}

async function login() {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error) {
    setMessage(error.message, true);
  }
}

async function logout() {
  await supabase.auth.signOut();
  resetAuthState();
  render();
}

function render() {
  if (isUnconfigured()) {
    root.innerHTML = renderUnconfigured();
    return;
  }

  if (!state.session) {
    root.innerHTML = renderLogin();
    bindGlobalActions();
    return;
  }

  if (state.appsLoaded && state.apps.length === 0) {
    root.innerHTML = renderNoApps();
    bindGlobalActions();
    return;
  }

  if (!state.content) {
    root.innerHTML = renderLoading();
    bindGlobalActions();
    return;
  }

  root.innerHTML = renderApp();
  bindGlobalActions();
  bindForms();
}

function isUnconfigured() {
  return SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');
}

function renderUnconfigured() {
  return `
    <section class="panel center-panel">
      <div>
        <p class="eyebrow">Configuração</p>
        <h1>Preencha o config.js</h1>
        <p class="muted">Atualize <strong>apps/static-admin/src/config.js</strong> com a URL e a publishable key do Supabase.</p>
      </div>
    </section>
  `;
}

function renderLogin() {
  return `
    <section class="panel center-panel">
      <div>
        <p class="eyebrow">SimulaEdu Admin</p>
        <h1>Entre com Google</h1>
        <p class="muted">Somente emails autorizados conseguem editar apps.</p>
        <button class="btn" data-action="login">Entrar com Google</button>
      </div>
    </section>
  `;
}

function renderNoApps() {
  return `
    <section class="panel center-panel">
      <div>
        <p class="eyebrow">Sem acesso</p>
        <h1>Nenhum app disponível</h1>
        <p class="muted">O email <strong>${escapeHtml(state.session.user.email)}</strong> não tem acesso a nenhum app cadastrado.</p>
        <p class="muted">Peça para um administrador liberar este email para o app correto.</p>
        <div class="row" style="justify-content: center">
          <button class="btn" data-action="retry-load">Verificar novamente</button>
          <button class="btn secondary" data-action="logout">Sair</button>
        </div>
      </div>
    </section>
  `;
}

function renderLoading() {
  return `
    <section class="panel center-panel">
      <div>
        <p class="eyebrow">SimulaEdu Admin</p>
        <h1>${state.message?.isError ? 'Não foi possível carregar' : 'Carregando conteúdo…'}</h1>
        <p class="muted">${state.message?.isError ? escapeHtml(state.message.text) : 'Validando sessão e permissões.'}</p>
        <div class="row" style="justify-content: center">
          ${state.message?.isError ? '<button class="btn" data-action="retry-load">Tentar novamente</button>' : ''}
          <button class="btn secondary" data-action="logout">Sair</button>
        </div>
      </div>
    </section>
  `;
}

function renderApp() {
  const app = state.content.app;
  return `
    <header class="topbar">
      <div class="brand">
        <p class="eyebrow">SimulaEdu Admin</p>
        <h1>${escapeHtml(app.name)}</h1>
        <p class="muted">${escapeHtml(app.teacherName)} · ${escapeHtml(state.session.user.email)}</p>
      </div>
      <div class="row">
        ${renderAppSelector()}
        <button class="btn secondary" data-action="reload">Recarregar</button>
        <button class="btn" data-action="publish">Publicar conteúdo</button>
        <button class="btn secondary" data-action="logout">Sair</button>
      </div>
    </header>
    ${state.message ? `<div class="notice ${state.message.isError ? 'error' : ''}"><span>${escapeHtml(state.message.text)}</span><button type="button" aria-label="Fechar aviso" data-action="dismiss-message">×</button></div>` : ''}
    <main class="grid">
      <nav class="panel nav">
        ${navButton('exam-types', 'Tipos de prova')}
        ${navButton('themes', 'Matérias')}
        ${navButton('questions', 'Questões')}
        ${navButton('publications', 'Publicações')}
      </nav>
      <section class="stack">
        ${state.section === 'exam-types' ? renderExamTypes() : ''}
        ${state.section === 'themes' ? renderThemes() : ''}
        ${state.section === 'questions' ? renderQuestions() : ''}
        ${state.section === 'publications' ? renderPublications() : ''}
      </section>
    </main>
  `;
}

function renderAppSelector() {
  if (state.apps.length <= 1) return '';
  return `
    <select data-action="select-app" aria-label="Selecionar app">
      ${state.apps.map((app) => `<option value="${escapeHtml(app.slug)}" ${app.slug === state.appSlug ? 'selected' : ''}>${escapeHtml(app.name)}</option>`).join('')}
    </select>
  `;
}

function navButton(section, label) {
  return `<button class="${state.section === section ? 'active' : ''}" data-section="${section}">${label}</button>`;
}


function isEditing(kind, id) {
  if (state.editing?.kind !== kind || state.editing?.isNew) return false;

  if (kind === 'question') {
    return state.editing.item?.number === id;
  }

  return state.editing.item?.id === id;
}

function isCreating(kind) {
  return state.editing?.kind === kind && state.editing?.isNew;
}

function renderExamTypes() {
  const examTypes = state.content.examTypes ?? [];
  return `
    <article class="panel stack">
      <div class="row space-between">
        <div>
          <p class="eyebrow">Tipos de prova</p>
          <h2>Estrutura do app</h2>
        </div>
        <button class="btn" data-edit="exam-type:new">Novo tipo de prova</button>
      </div>
      ${isCreating('exam-type') ? renderExamTypeForm(state.editing.item) : ''}
      <div class="list">
        ${examTypes.length ? examTypes.map((examType, index) => renderExamTypeItem(examType, index, examTypes.length)).join('') : '<div class="empty">Nenhum tipo de prova cadastrado.</div>'}
      </div>
    </article>
  `;
}

function renderExamTypeItem(examType, index, totalCount) {
  if (isEditing('exam-type', examType.id)) return renderExamTypeForm(examType);

  return `
    <div class="item">
      <div class="row space-between">
        <div>
          <div class="item-title">${escapeHtml(examType.name)}</div>
          <div class="item-meta">Padrão: ${examType.default_question_count} questões · ${secondsToMinutes(examType.default_duration_in_seconds)} min</div>
        </div>
        <div class="row">
          ${index > 0 ? `<button class="btn secondary" data-reorder-exam-type="${examType.id}" data-direction="up">↑</button>` : ''}
          ${index < totalCount - 1 ? `<button class="btn secondary" data-reorder-exam-type="${examType.id}" data-direction="down">↓</button>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" data-edit="exam-type:${examType.id}">Editar</button>
        <button class="btn danger" data-delete-exam-type="${examType.id}">Excluir</button>
      </div>
    </div>
  `;
}

function renderExamTypeForm(examType = {}) {
  const isNew = !examType.id;
  return `
    <form class="card form-grid" data-form="exam-type" data-id="${examType.id ?? ''}">
      <h3>${isNew ? 'Novo tipo de prova' : 'Editar tipo de prova'}</h3>
      <label>Nome <input name="name" required value="${escapeHtml(examType.name ?? '')}" /></label>
      <div class="form-grid two">
        <label>Questões padrão <input name="defaultQuestionCount" required type="number" min="1" value="${escapeHtml(examType.default_question_count ?? '')}" /></label>
        <label>Opções de questões <input name="questionCountOptions" required placeholder="5, 10, 20" value="${escapeHtml((examType.question_count_options ?? []).join(', '))}" /></label>
      </div>
      <div class="form-grid two">
        <label>Duração padrão em segundos <input name="defaultDurationInSeconds" required type="number" min="60" value="${escapeHtml(examType.default_duration_in_seconds ?? '')}" /></label>
        <label>Opções de duração em segundos <input name="durationOptionsInSeconds" required placeholder="600, 1200, 3600" value="${escapeHtml((examType.duration_options_in_seconds ?? []).join(', '))}" /></label>
      </div>
      <div class="actions">
        <button class="btn" type="submit">Salvar</button>
        <button class="btn secondary" type="button" data-action="cancel-edit">Cancelar</button>
      </div>
    </form>
  `;
}

function renderThemes() {
  const examTypes = state.content.examTypes ?? [];
  const themesByExamType = new Map(examTypes.map((examType) => [examType.id, []]));
  for (const theme of state.content.themes ?? []) {
    if (!themesByExamType.has(theme.exam_type_id)) themesByExamType.set(theme.exam_type_id, []);
    themesByExamType.get(theme.exam_type_id).push(theme);
  }

  return `
    <article class="panel stack">
      <div class="row space-between">
        <div>
          <p class="eyebrow">Matérias</p>
          <h2>Conteúdo por tipo de prova</h2>
        </div>
        <button class="btn" data-edit="theme:new">Nova matéria</button>
      </div>
      ${isCreating('theme') ? renderThemeForm(state.editing.item) : ''}
      ${examTypes.map((examType) => `
        <section class="card">
          <h3>${escapeHtml(examType.name)}</h3>
          <div class="list">
            ${(themesByExamType.get(examType.id) ?? []).length ? themesByExamType.get(examType.id).map((theme, index, group) => renderThemeItem(theme, index, group.length)).join('') : '<div class="empty">Nenhuma matéria neste tipo de prova.</div>'}
          </div>
        </section>
      `).join('')}
    </article>
  `;
}

function renderThemeItem(theme, index, totalCount) {
  if (isEditing('theme', theme.id) || isEditing('theme-questions', theme.id)) return renderThemeForm(theme);

  const questionCount = (state.content.themeQuestions ?? []).filter((link) => link.theme_id === theme.id).length;
  return `
    <div class="item">
      <div class="row space-between">
        <div>
          <div class="item-title">${escapeHtml(theme.name)}</div>
          <div class="item-meta">${questionCount} questões · ${theme.is_free ? '<span class="badge">Grátis</span>' : '<span class="badge locked">Premium</span>'} ${theme.is_default_for_free_users ? '<span class="badge">Padrão grátis</span>' : ''}</div>
        </div>
        <div class="row">
          ${index > 0 ? `<button class="btn secondary" data-reorder-theme="${theme.id}" data-direction="up">↑</button>` : ''}
          ${index < totalCount - 1 ? `<button class="btn secondary" data-reorder-theme="${theme.id}" data-direction="down">↓</button>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" data-edit="theme:${theme.id}">Editar</button>
        <button class="btn secondary" data-edit="theme-questions:${theme.id}">Questões</button>
        <button class="btn danger" data-delete-theme="${theme.id}">Excluir</button>
      </div>
    </div>
  `;
}

function renderThemeForm(theme = {}) {
  if (state.editing.kind === 'theme-questions') return renderThemeQuestionsForm(theme);
  const examTypes = state.content.examTypes ?? [];
  const isNew = !theme.id;
  return `
    <form class="card form-grid" data-form="theme" data-id="${theme.id ?? ''}">
      <h3>${isNew ? 'Nova matéria' : 'Editar matéria'}</h3>
      <div class="form-grid two">
        <label>Nome <input name="name" required value="${escapeHtml(theme.name ?? '')}" /></label>
        <label>Tipo de prova
          <select name="examTypeId" required>
            ${examTypes.map((examType) => `<option value="${examType.id}" ${examType.id === theme.exam_type_id ? 'selected' : ''}>${escapeHtml(examType.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="checkline"><input type="checkbox" name="isFree" data-action="toggle-theme-free" ${theme.is_free ? 'checked' : ''} /> Disponível para usuários grátis</label>
      <label class="checkline ${theme.is_free ? '' : 'hidden'}" data-default-free-row><input type="checkbox" name="isDefaultForFreeUsers" ${theme.is_default_for_free_users ? 'checked' : ''} /> Padrão para usuários grátis</label>
      <div class="actions">
        <button class="btn" type="submit">Salvar</button>
        <button class="btn secondary" type="button" data-action="cancel-edit">Cancelar</button>
      </div>
    </form>
  `;
}

function renderThemeQuestionsForm(theme) {
  const selectedNumbers = (state.content.themeQuestions ?? []).filter((link) => link.theme_id === theme.id).map((link) => link.question_number).join(', ');
  return `
    <form class="card form-grid" data-form="theme-questions" data-id="${theme.id}">
      <h3>Questões de ${escapeHtml(theme.name)}</h3>
      <label>Números das questões <textarea name="questionNumbers" placeholder="1, 2, 3">${escapeHtml(selectedNumbers)}</textarea><span class="field-help">Use números separados por vírgula.</span></label>
      <div class="actions">
        <button class="btn" type="submit">Salvar questões</button>
        <button class="btn secondary" type="button" data-action="cancel-edit">Cancelar</button>
      </div>
    </form>
  `;
}

function renderQuestions() {
  const examTypes = state.content.examTypes ?? [];
  const themes = filteredThemesForQuestions();
  const questions = filteredQuestions();
  return `
    <article class="panel stack">
      <div class="row space-between">
        <div>
          <p class="eyebrow">Questões</p>
          <h2>Banco de perguntas</h2>
        </div>
        <button class="btn" data-edit="question:new">Nova questão</button>
      </div>
      <div class="card form-grid three">
        <label>Buscar
          <input type="search" data-action="search-questions" placeholder="Número, enunciado ou alternativa" value="${escapeHtml(state.questionSearch)}" />
        </label>
        <label>Filtrar por tipo de prova
          <select data-action="filter-exam-type">
            <option value="">Todos</option>
            ${examTypes.map((examType) => `<option value="${examType.id}" ${String(examType.id) === String(state.questionFilterExamTypeId) ? 'selected' : ''}>${escapeHtml(examType.name)}</option>`).join('')}
          </select>
        </label>
        <label class="${state.questionFilterExamTypeId ? '' : 'hidden'}">Filtrar por matéria
          <select data-action="filter-theme">
            <option value="">Todas</option>
            ${themes.map((theme) => `<option value="${theme.id}" ${String(theme.id) === String(state.questionFilterThemeId) ? 'selected' : ''}>${escapeHtml(theme.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${isCreating('question') ? renderQuestionForm(state.editing.item) : ''}
      ${renderQuestionList(questions)}
    </article>
  `;
}

function renderQuestionList(questions) {
  if (!questions.length) {
    return '<div class="list" data-questions-list><div class="empty">Nenhuma questão encontrada.</div></div>';
  }

  const visibleQuestionCount = questions.filter(questionMatchesSearch).length;
  return `
    <div class="list" data-questions-list>
      ${questions.map((question) => renderQuestionItem(question)).join('')}
      <div class="empty ${visibleQuestionCount ? 'hidden' : ''}" data-question-search-empty>Nenhuma questão encontrada.</div>
    </div>
  `;
}

function filteredThemesForQuestions() {
  return (state.content.themes ?? []).filter((theme) => !state.questionFilterExamTypeId || String(theme.exam_type_id) === String(state.questionFilterExamTypeId));
}

function filteredQuestions() {
  const questions = state.content.questions ?? [];
  if (!state.questionFilterThemeId && !state.questionFilterExamTypeId) return questions;

  const themeIds = state.questionFilterThemeId
    ? [Number(state.questionFilterThemeId)]
    : filteredThemesForQuestions().map((theme) => theme.id);
  const questionNumbers = new Set((state.content.themeQuestions ?? []).filter((link) => themeIds.includes(link.theme_id)).map((link) => link.question_number));

  return questions.filter((question) => questionNumbers.has(question.number));
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function questionSearchText(question) {
  return normalizeSearchText([
    question.number,
    question.description,
    ...(question.alternatives ?? []).flatMap((alternative) => [alternative.id, alternative.text]),
  ].join(' '));
}

function questionMatchesSearch(question) {
  const query = normalizeSearchText(state.questionSearch);
  return !query || questionSearchText(question).includes(query);
}

function renderQuestionItem(question) {
  if (isEditing('question', question.number)) return renderQuestionForm(question);

  const answer = question.alternatives?.find((alternative) => alternative.id === question.correct_alternative_id);
  const isHiddenBySearch = !questionMatchesSearch(question);
  return `
    <div class="item ${isHiddenBySearch ? 'hidden' : ''}" data-question-item data-question-search="${escapeHtml(questionSearchText(question))}">
      <div class="item-title">#${question.number}</div>
      <p>${escapeHtml(question.description)}</p>
      <div class="item-meta"><strong>Resposta:</strong> ${escapeHtml(answer ? `${answer.id}. ${answer.text}` : question.correct_alternative_id)}</div>
      <div class="actions">
        <button class="btn secondary" data-edit="question:${question.number}">Editar</button>
        <button class="btn danger" data-delete-question="${question.number}">Excluir</button>
      </div>
    </div>
  `;
}

function renderPublications() {
  const versions = state.content.publishedContentVersions ?? [];
  return `
    <article class="panel stack">
      <div>
        <p class="eyebrow">Publicações</p>
        <h2>Versões publicadas</h2>
      </div>
      <div class="list">
        ${versions.length ? versions.map((version) => renderPublicationItem(version)).join('') : '<div class="empty">Nenhuma publicação encontrada.</div>'}
      </div>
    </article>
  `;
}

function renderPublicationItem(version) {
  return `
    <div class="item">
      <div class="item-title">Versão ${version.version}</div>
      <div class="item-meta">Publicada em ${escapeHtml(formatDateTime(version.published_at))}</div>
      ${version.minimum_app_version ? `<div class="item-meta">Versão mínima do app: ${escapeHtml(version.minimum_app_version)}</div>` : ''}
      <div class="actions">
        <button class="btn secondary" data-download-publication="${version.version}">Baixar</button>
      </div>
    </div>
  `;
}

function renderQuestionForm(question = {}) {
  const alternatives = question.alternatives?.length ? question.alternatives : Array.from({ length: 5 }, (_value, index) => ({ id: alternativeLetter(index), text: '' }));
  const correctAlternativeId = question.correct_alternative_id ?? alternatives[0]?.id ?? 'A';
  return `
    <form class="card form-grid" data-form="question" data-id="${question.__isNew ? '' : question.number ?? ''}">
      <h3>${question.__isNew ? 'Nova questão' : 'Editar questão'}</h3>
      <label>Número <input name="number" required type="number" min="1" value="${escapeHtml(question.number ?? '')}" ${question.__isNew ? '' : 'readonly'} /></label>
      <label>Enunciado <textarea name="description" required>${escapeHtml(question.description ?? '')}</textarea></label>
      <div>
        <strong>Alternativas</strong>
        <div data-alternatives>
          ${alternatives.map((alternative, index) => renderAlternativeRow(alternative, index, correctAlternativeId)).join('')}
        </div>
        <button class="btn secondary" type="button" data-action="add-alternative">Adicionar alternativa</button>
      </div>
      <div class="actions">
        <button class="btn" type="submit">Salvar</button>
        <button class="btn secondary" type="button" data-action="cancel-edit">Cancelar</button>
      </div>
    </form>
  `;
}

function renderAlternativeRow(alternative, index, correctAlternativeId) {
  return `
    <div class="alternative-row" data-alternative-row>
      <input type="radio" name="correctAlternativeId" value="${escapeHtml(alternative.id)}" ${alternative.id === correctAlternativeId ? 'checked' : ''} />
      <input name="alternativeId" value="${escapeHtml(alternative.id)}" aria-label="ID da alternativa" readonly />
      <input name="alternativeText" value="${escapeHtml(alternative.text)}" placeholder="Texto da alternativa ${alternativeLetter(index)}" required />
      <button class="btn danger" type="button" data-action="remove-alternative">Remover</button>
    </div>
  `;
}

function applyQuestionSearch() {
  const query = normalizeSearchText(state.questionSearch);
  const items = [...root.querySelectorAll('[data-question-item]')];
  let visibleCount = 0;

  for (const item of items) {
    const isVisible = !query || item.dataset.questionSearch.includes(query);
    item.classList.toggle('hidden', !isVisible);
    if (isVisible) visibleCount += 1;
  }

  root.querySelector('[data-question-search-empty]')?.classList.toggle('hidden', visibleCount > 0 || items.length === 0);
}

function bindGlobalActions() {
  root.querySelector('[data-action="login"]')?.addEventListener('click', () => { login(); });
  root.querySelectorAll('[data-action="logout"]').forEach((button) => button.addEventListener('click', () => { logout(); }));
  root.querySelector('[data-action="toggle-theme-free"]')?.addEventListener('change', (event) => {
    const form = event.target.closest('form');
    const defaultFreeRow = form?.querySelector('[data-default-free-row]');
    const defaultFreeInput = form?.querySelector('[name="isDefaultForFreeUsers"]');

    defaultFreeRow?.classList.toggle('hidden', !event.target.checked);

    if (!event.target.checked && defaultFreeInput) {
      defaultFreeInput.checked = false;
    }
  });
  root.querySelector('[data-action="reload"]')?.addEventListener('click', async () => {
    state.message = null;
    render();
    try {
      await loadContent({ force: true });
      setMessage('Página recarregada com sucesso.');
    } catch (error) {
      setMessage(error.message, true);
    }
  });
  root.querySelector('[data-action="retry-load"]')?.addEventListener('click', () => {
    state.appsLoaded = false;
    state.message = null;
    render();
    loadApps();
  });
  root.querySelector('[data-action="publish"]')?.addEventListener('click', publishContent);
  root.querySelector('[data-action="dismiss-message"]')?.addEventListener('click', () => { state.message = null; render(); });
  root.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', () => { state.editing = null; render(); });
  root.querySelector('[data-action="select-app"]')?.addEventListener('change', async (event) => {
    state.appSlug = event.target.value;
    state.content = null;
    state.message = null;
    render();
    await loadContent();
  });
  root.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => {
    state.section = button.dataset.section;
    state.editing = null;
    render();
  }));
  root.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => startEdit(button.dataset.edit)));
  root.querySelectorAll('[data-delete-exam-type]').forEach((button) => button.addEventListener('click', () => deleteResource('exam-types', button.dataset.deleteExamType, 'Excluir este tipo de prova?')));
  root.querySelectorAll('[data-delete-theme]').forEach((button) => button.addEventListener('click', () => deleteResource('themes', button.dataset.deleteTheme, 'Excluir esta matéria?')));
  root.querySelectorAll('[data-delete-question]').forEach((button) => button.addEventListener('click', () => deleteResource('questions', button.dataset.deleteQuestion, 'Excluir esta questão?')));
  root.querySelectorAll('[data-download-publication]').forEach((button) => button.addEventListener('click', () => downloadPublication(button.dataset.downloadPublication)));
  root.querySelectorAll('[data-reorder-exam-type]').forEach((button) => button.addEventListener('click', () => reorderResource('exam-types', button.dataset.reorderExamType, button.dataset.direction)));
  root.querySelectorAll('[data-reorder-theme]').forEach((button) => button.addEventListener('click', () => reorderResource('themes', button.dataset.reorderTheme, button.dataset.direction)));
  root.querySelector('[data-action="filter-exam-type"]')?.addEventListener('change', (event) => {
    state.questionFilterExamTypeId = event.target.value;
    state.questionFilterThemeId = '';
    render();
  });
  root.querySelector('[data-action="filter-theme"]')?.addEventListener('change', (event) => {
    state.questionFilterThemeId = event.target.value;
    render();
  });
  root.querySelector('[data-action="search-questions"]')?.addEventListener('input', (event) => {
    state.questionSearch = event.target.value;
    applyQuestionSearch();
  });
  root.querySelector('[data-action="add-alternative"]')?.addEventListener('click', addAlternativeRow);
  root.querySelectorAll('[data-action="remove-alternative"]').forEach((button) => button.addEventListener('click', removeAlternativeRow));
}

function bindForms() {
  root.querySelectorAll('form[data-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormError(form);
      try {
        await submitForm(form);
        await loadContent();
        setMessage('Salvo com sucesso.');
      } catch (error) {
        showFormError(form, error.message);
      }
    });
  });
}

function clearFormError(form) {
  form.querySelector('[data-form-error]')?.remove();
}

function showFormError(form, message) {
  clearFormError(form);
  form.insertAdjacentHTML('afterbegin', `<div class="form-error" data-form-error>${escapeHtml(message)}</div>`);
}

function startEdit(token) {
  const [kind, id] = token.split(':');
  const isNew = id === 'new';
  const item = isNew ? buildNewItem(kind) : findItem(kind, Number(id));
  state.editing = { kind, item, isNew };
  render();
}

function findItem(kind, id) {
  if (kind === 'exam-type') return state.content.examTypes.find((item) => item.id === id);
  if (kind === 'theme' || kind === 'theme-questions') return state.content.themes.find((item) => item.id === id);
  if (kind === 'question') return state.content.questions.find((item) => item.number === id);
  return buildNewItem(kind);
}

function buildNewItem(kind) {
  if (kind === 'question') {
    const nextQuestionNumber = Math.max(0, ...(state.content.questions ?? []).map((question) => question.number)) + 1;
    return { number: nextQuestionNumber, __isNew: true };
  }

  return {};
}

async function submitForm(form) {
  const formData = new FormData(form);
  const id = form.dataset.id;
  const formKind = form.dataset.form;

  if (formKind === 'exam-type') {
    const body = {
      name: formData.get('name'),
      defaultQuestionCount: parsePositiveInteger(formData.get('defaultQuestionCount'), 'Quantidade padrão de questões'),
      questionCountOptions: parsePositiveIntegerList(formData.get('questionCountOptions'), 'Opções de questões'),
      defaultDurationInSeconds: parsePositiveInteger(formData.get('defaultDurationInSeconds'), 'Duração padrão'),
      durationOptionsInSeconds: parsePositiveIntegerList(formData.get('durationOptionsInSeconds'), 'Opções de duração'),
    };

    if (!body.questionCountOptions.includes(body.defaultQuestionCount)) {
      throw new Error('A quantidade padrão de questões precisa estar na lista de opções.');
    }

    if (!body.durationOptionsInSeconds.includes(body.defaultDurationInSeconds)) {
      throw new Error('A duração padrão precisa estar na lista de opções.');
    }

    return saveResource('exam-types', id, body);
  }

  if (formKind === 'theme') {
    const body = {
      name: formData.get('name'),
      examTypeId: parsePositiveInteger(formData.get('examTypeId'), 'Tipo de prova'),
      isFree: formData.has('isFree'),
      isDefaultForFreeUsers: formData.has('isDefaultForFreeUsers'),
    };

    if (body.isDefaultForFreeUsers && !body.isFree) {
      throw new Error('Uma matéria padrão para usuários grátis também precisa estar disponível para usuários grátis.');
    }

    return saveResource('themes', id, body);
  }

  if (formKind === 'theme-questions') {
    return api(`/apps/${state.appSlug}/themes/${id}/questions`, {
      method: 'PUT',
      body: JSON.stringify({ questionNumbers: parsePositiveIntegerList(formData.get('questionNumbers'), 'Questões', { allowEmpty: true }) }),
    });
  }

  if (formKind === 'question') {
    const alternatives = [...form.querySelectorAll('[data-alternative-row]')].map((row) => ({
      id: row.querySelector('[name="alternativeId"]').value,
      text: row.querySelector('[name="alternativeText"]').value,
    }));
    const body = {
      number: parsePositiveInteger(formData.get('number'), 'Número da questão'),
      description: formData.get('description'),
      alternatives,
      correctAlternativeId: formData.get('correctAlternativeId'),
    };

    validateAlternatives(body.alternatives, body.correctAlternativeId);

    if (!id && (state.content.questions ?? []).some((question) => question.number === body.number)) {
      throw new Error(`Já existe uma questão com o número ${body.number}.`);
    }

    return saveResource('questions', id, body);
  }
}

async function saveResource(resource, id, body) {
  const isNew = !id;
  return api(`/apps/${state.appSlug}/${resource}${isNew ? '' : `/${id}`}`, {
    method: isNew ? 'POST' : 'PUT',
    body: JSON.stringify(body),
  });
}

async function deleteResource(resource, id, confirmation) {
  if (!window.confirm(confirmation)) return;
  try {
    await api(`/apps/${state.appSlug}/${resource}/${id}`, { method: 'DELETE' });
    await loadContent();
    setMessage('Excluído com sucesso.');
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function reorderResource(resource, id, direction) {
  try {
    await api(`/apps/${state.appSlug}/${resource}/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    await loadContent();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function downloadPublication(version) {
  try {
    const payload = await api(`/apps/${state.appSlug}/publications/${version}`);
    const blob = new Blob([`${JSON.stringify(payload.content, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${state.appSlug}-content-v${version}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function publishContent() {
  if (!window.confirm('Publicar uma nova versão do conteúdo deste app?')) return;
  try {
    const payload = await api(`/apps/${state.appSlug}/publish`, { method: 'POST', body: JSON.stringify({}) });
    await loadContent({ force: true });
    setMessage(`Conteúdo publicado. Versão ${payload.version}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function addAlternativeRow() {
  const container = root.querySelector('[data-alternatives]');
  const rows = [...container.querySelectorAll('[data-alternative-row]')];
  const id = alternativeLetter(rows.length);
  container.insertAdjacentHTML('beforeend', renderAlternativeRow({ id, text: '' }, rows.length, rows.length === 0 ? id : ''));
  normalizeAlternatives();
  container.querySelector('[data-alternative-row]:last-child [data-action="remove-alternative"]').addEventListener('click', removeAlternativeRow);
}

function removeAlternativeRow(event) {
  const rows = [...root.querySelectorAll('[data-alternative-row]')];
  if (rows.length <= 1) {
    setMessage('A questão precisa ter pelo menos uma alternativa.', true);
    return;
  }

  event.target.closest('[data-alternative-row]').remove();
  normalizeAlternatives();
}

function normalizeAlternatives() {
  const rows = [...root.querySelectorAll('[data-alternative-row]')];
  let checkedIndex = rows.findIndex((row) => row.querySelector('[name="correctAlternativeId"]').checked);
  if (checkedIndex < 0) checkedIndex = 0;

  rows.forEach((row, index) => {
    const id = alternativeLetter(index);
    const radio = row.querySelector('[name="correctAlternativeId"]');
    row.querySelector('[name="alternativeId"]').value = id;
    row.querySelector('[name="alternativeText"]').placeholder = `Texto da alternativa ${id}`;
    radio.value = id;
    radio.checked = index === checkedIndex;
  });
}

boot();
