const app = document.querySelector('#app');
let me = null; // pieslēgušais lietotājs { id, name, email }
let invitationCount = 0;

// pieprasījums serverim, kļūdas gadījumā error.fields satur kļūdas pie laukiem
async function api(method, url, body) {
  let response;
  try {
    response = await fetch('/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'planotajs' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Nav savienojuma ar serveri.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Kaut kas nogāja greizi.');
    error.fields = data.fields || null;
    error.status = response.status;
    // sesija beigusies, atpakaļ uz pieslēgšanos
    if (response.status === 401) location.href = 'login.html';
    throw error;
  }
  return data;
}

// No XSS for you

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PRIORITY_NAMES = { high: 'Augsta', medium: 'Vidēja', low: 'Zema' };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// šodienas datums tādā pašā formā kā dueDate, lai var salīdzināt
function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// datums kā dd.mm.gggg
function showDate(date) {
  return date ? date.split('-').reverse().join('.') : '';
}

const isLate = (task) => !task.completed && task.dueDate && task.dueDate < today();

let messageTimer;
function showMessage(text) {
  const box = document.querySelector('#message');
  box.textContent = text;
  box.classList.add('show');
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => box.classList.remove('show'), 3000);
}

// parāda kļūdas pie formas laukiem
function showErrors(form, error) {
  clearErrors(form);
  const fields = error.fields || {};
  for (const [name, text] of Object.entries(fields)) {
    const place = form.querySelector(`[data-error="${name}"]`);
    if (place) place.textContent = text;
    form.elements[name]?.classList.add('invalid');
  }
  const general = form.querySelector('[data-error="form"]');
  if (general && !Object.keys(fields).length) general.textContent = error.message;
  else if (!general && !Object.keys(fields).length) showMessage(error.message);
  form.querySelector('.invalid')?.focus();
}

function clearErrors(form) {
  form.querySelectorAll('[data-error]').forEach((place) => (place.textContent = ''));
  form.querySelectorAll('.invalid').forEach((field) => field.classList.remove('invalid'));
}

const formData = (form) => Object.fromEntries(new FormData(form));

// lapas

const pages = [
  [/^#\/$/, homePage],
  [/^#\/projekti$/, projectsPage],
  [/^#\/projekti\/(\d+)$/, projectPage],
  [/^#\/uzaicinajumi$/, invitationsPage],
];

async function showPage() {
  const hash = location.hash || '#/';

  try {
    const data = await api('GET', '/me');
    me = data.user;
    invitationCount = data.invitations;
  } catch (error) {
    app.innerHTML = `<p class="loading">${esc(error.message)}</p>`;
    return;
  }

  // nav pieslēdzies, ejam uz login.html
  if (!me) return (location.href = 'login.html');

  for (const [pattern, page] of pages) {
    const match = hash.match(pattern);
    if (match) return page(...match.slice(1));
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', showPage);
showPage();

function layout(content) {
  const hash = location.hash || '#/';
  const link = (href, text) => {
    const active = href === '#/' ? hash === '#/' : hash.startsWith(href);
    return `<a href="${href}" class="${active ? 'active' : ''}">${text}</a>`;
  };
  
  app.innerHTML = `
    <header>
      <a href="#/" class="logo">Plānotājs</a>
      <nav>
        ${link('#/', 'Pārskats')}
        ${link('#/projekti', 'Projekti')}
        ${link('#/uzaicinajumi', 'Uzaicinājumi' + (invitationCount ? ` (${invitationCount})` : ''))}
      </nav>
      <div class="dark-mode-toggle" id="dark-mode-toggle" title="Pārslēgt tumšo režīmu">Tumšais režīms</div>
      <div class="user">
        ${esc(me.name)}
        <button class="secondary small" id="logout">Iziet</button>
        <button class="delete" id="delete-account" title="Izdzēst kontu">Izdzēst kontu</button>
      </div>
    </header>
    <main>${content}</main>`;

  // Izlogošanās pogas Notikumu klausītājs
  app.querySelector('#logout').addEventListener('click', async () => {
    await api('POST', '/logout').catch(() => {});
    location.href = 'login.html';
  });

  // Konta dzēšanas pogas Notikumu klausītājs
  app.querySelector('#delete-account').addEventListener('click', () => {
    document.querySelector('#delete-error').textContent = '';
    document.querySelector('#delete-dialog').showModal();
  });

  // Tumšā režīma pārslēdzēja notikumu klausītājs (piesaistīts no jauna katrā renderēšanas reizē)
  const darkModeToggle = app.querySelector('#dark-mode-toggle');
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDarkMode = document.body.classList.contains('dark-mode');
      localStorage.setItem('darkMode', isDarkMode ? 'true' : 'false');
    });
  }

  return app.querySelector('main');
}

// Load dark mode

window.addEventListener('DOMContentLoaded', () => {
  const darkModePreference = localStorage.getItem('darkMode');
  if (darkModePreference === 'true') {
    document.body.classList.add('dark-mode');
  }
});

// uzdevumu saraksts (izmanto gan pārskats, gan projekta lapa)

// choice: show (active vai done), priority, sort un assignee
function filterTasks(tasks, choice) {
  const list = tasks.filter((task) => {
    if (choice.show === 'active' && task.completed) return false;
    if (choice.show === 'done' && !task.completed) return false;
    if (choice.priority && task.priority !== choice.priority) return false;
    if (choice.assignee === 'me' && task.assignee?.id !== me.id) return false;
    if (choice.assignee === 'none' && task.assignee) return false;
    return true;
  });

  const byDate = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const byPriority = (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  const sorters = {
    date: (a, b) => byDate(a, b) || byPriority(a, b),
    priority: (a, b) => byPriority(a, b) || byDate(a, b),
    title: (a, b) => a.title.localeCompare(b.title, 'lv'),
    newest: (a, b) => b.id - a.id,
  };
  return list.sort(sorters[choice.sort] || sorters.date);
}

function filterBar(choice, { counts, withAssignee = false }) {
  const option = (key, value, text) => `<option value="${value}" ${choice[key] === value ? 'selected' : ''}>${text}</option>`;
  return `
    <div class="filters">
      <button type="button" data-show="active" class="${choice.show === 'active' ? '' : 'secondary'}">Aktīvie (${counts.active})</button>
      <button type="button" data-show="done" class="${choice.show === 'done' ? '' : 'secondary'}">Pabeigtie (${counts.done})</button>
      <select data-choice="priority" aria-label="Prioritāte">
        ${option('priority', '', 'Visas prioritātes')}
        ${option('priority', 'high', 'Augsta')}
        ${option('priority', 'medium', 'Vidēja')}
        ${option('priority', 'low', 'Zema')}
      </select>
      ${withAssignee ? `
      <select data-choice="assignee" aria-label="Atbildīgais">
        ${option('assignee', '', 'Visi uzdevumi')}
        ${option('assignee', 'me', 'Man piešķirtie')}
        ${option('assignee', 'none', 'Nepiešķirtie')}
      </select>` : ''}
      <select data-choice="sort" aria-label="Kārtot">
        ${option('sort', 'date', 'Pēc termiņa')}
        ${option('sort', 'priority', 'Pēc prioritātes')}
        ${option('sort', 'title', 'Pēc nosaukuma')}
        ${option('sort', 'newest', 'Jaunākie')}
      </select>
    </div>`;
}

function listenToFilters(box, choice, redraw) {
  box.querySelectorAll('[data-show]').forEach((button) =>
    button.addEventListener('click', () => {
      choice.show = button.dataset.show;
      redraw();
    }));
  box.querySelectorAll('[data-choice]').forEach((select) =>
    select.addEventListener('change', () => {
      choice[select.dataset.choice] = select.value;
      redraw();
    }));
}

function taskItem(task, { showProject = false } = {}) {
  const info = [`<span class="${task.priority}">${PRIORITY_NAMES[task.priority]} prioritāte</span>`];
  if (task.dueDate) info.push(`<span class="${isLate(task) ? 'late' : ''}">termiņš ${showDate(task.dueDate)}${isLate(task) ? ' (nokavēts)' : ''}</span>`);
  if (showProject && task.project) info.push(`<a href="#/projekti/${task.project.id}">${esc(task.project.name)}</a>`);
  if (task.project) info.push(task.assignee ? 'atbildīgais: ' + esc(task.assignee.name) : 'nav piešķirts');

  return `
    <li class="task ${task.completed ? 'done' : ''}">
      ${task.canComplete
        ? `<input type="checkbox" data-complete="${task.id}" ${task.completed ? 'checked' : ''} aria-label="Pabeigts">`
        : '<span class="no-check"></span>'}
      <div class="task-body">
        <b>${esc(task.title)}</b>
        ${task.description ? `<p class="description">${esc(task.description)}</p>` : ''}
        <div class="info">${info.join(', ')}</div>
      </div>
      ${task.canEdit ? `
      <div class="task-buttons">
        <button class="secondary small" data-edit="${task.id}">Labot</button>
        <button class="danger small" data-delete="${task.id}">Dzēst</button>
      </div>` : ''}
    </li>`;
}

function taskList(tasks, options) {
  if (!tasks.length) return `<p class="empty">${options.emptyText}</p>`;
  return `<ul class="tasks">${tasks.map((task) => taskItem(task, options)).join('')}</ul>`;
}

// pabeigt, labot un dzēst pogas; reload() ielādē lapu no jauna
function listenToTasks(box, tasks, reload, members) {
  const find = (id) => tasks.find((task) => task.id === Number(id));

  box.querySelectorAll('[data-complete]').forEach((checkbox) =>
    checkbox.addEventListener('change', async () => {
      try {
        await api('PUT', `/tasks/${checkbox.dataset.complete}`, { completed: checkbox.checked });
        showMessage(checkbox.checked ? 'Uzdevums pabeigts.' : 'Uzdevums atkal aktīvs.');
        reload();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        showMessage(error.message);
      }
    }));

  box.querySelectorAll('[data-edit]').forEach((button) =>
    button.addEventListener('click', () => openTaskForm({ task: find(button.dataset.edit), members, onSaved: reload })));

  box.querySelectorAll('[data-delete]').forEach((button) =>
    button.addEventListener('click', async () => {
      const task = find(button.dataset.delete);
      if (!confirm(`Dzēst uzdevumu "${task.title}"?`)) return;
      try {
        await api('DELETE', `/tasks/${task.id}`);
        showMessage('Uzdevums dzēsts.');
        reload();
      } catch (error) {
        showMessage(error.message);
      }
    }));
}

// uzdevuma forma

const taskDialog = document.querySelector('#task-dialog');
const taskForm = document.querySelector('#task-form');
let saveTask = null;

// ja task nav padots, tad veido jaunu; members padod tikai projekta uzdevumiem
function openTaskForm({ task = null, projectId = null, members = null, onSaved }) {
  taskForm.reset();
  clearErrors(taskForm);
  document.querySelector('#task-dialog-title').textContent = task ? 'Labot uzdevumu' : 'Jauns uzdevums';

  const fields = taskForm.elements;
  fields.title.value = task?.title ?? '';
  fields.description.value = task?.description ?? '';
  fields.dueDate.value = task?.dueDate ?? '';
  fields.priority.value = task?.priority ?? 'medium';

  // atbildīgo var izvēlēties tikai projektā
  document.querySelector('#assignee-field').hidden = !members;
  if (members) {
    fields.assigneeId.innerHTML = '<option value="">Nav piešķirts</option>' +
      members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    fields.assigneeId.value = task?.assignee?.id ?? '';
  }

  saveTask = async () => {
    const data = formData(taskForm);
    if (!members) delete data.assigneeId;
    if (task) await api('PUT', `/tasks/${task.id}`, data);
    else await api('POST', '/tasks', { ...data, projectId });
    taskDialog.close();
    showMessage(task ? 'Izmaiņas saglabātas.' : 'Uzdevums pievienots.');
    onSaved();
  };

  taskDialog.showModal();
  fields.title.focus();
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = taskForm.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await saveTask();
  } catch (error) {
    showErrors(taskForm, error);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('dialog [data-close]').forEach((button) =>
  button.addEventListener('click', () => button.closest('dialog').close()));

// konta dzēšanas apstiprināšanas logs
document.querySelector('#confirm-delete').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('DELETE', '/me');
    location.href = 'login.html';
  } catch (error) {
    document.querySelector('#delete-error').textContent = error.message;
    button.disabled = false;
  }
});

// pārskats

const homeChoice = { show: 'active', priority: '', sort: 'date' };

async function homePage() {
  const main = layout('<p class="loading">Ielādē...</p>');
  let data;
  try {
    data = await api('GET', '/tasks');
  } catch (error) {
    main.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { tasks, assigned } = data;
  const all = [...tasks, ...assigned];
  const count = (list, done) => list.filter((task) => task.completed === done).length;
  const late = all.filter(isLate).length;

  main.innerHTML = `
    <div class="page-top">
      <h1>Sveiki, ${esc(me.name)}!</h1>
      <button id="new-task">+ Jauns uzdevums</button>
    </div>
    <div class="stats">
      <div class="box"><b>${count(all, false)}</b>Aktīvi uzdevumi</div>
      <div class="box"><b>${count(all, true)}</b>Pabeigti</div>
      <div class="box"><b class="${late ? 'late' : ''}">${late}</b>Nokavēti</div>
      <div class="box"><b>${count(assigned, false)}</b>Piešķirti projektos</div>
    </div>
    <div id="lists"></div>`;

  main.querySelector('#new-task').addEventListener('click', () => openTaskForm({ onSaved: homePage }));

  const lists = main.querySelector('#lists');
  const draw = () => {
    lists.innerHTML = `
      <section class="box">
        <h2>Mani uzdevumi</h2>
        ${filterBar(homeChoice, { counts: { active: count(all, false), done: count(all, true) } })}
        ${taskList(filterTasks(tasks, homeChoice), {
          emptyText: homeChoice.show === 'active' ? 'Nav aktīvu uzdevumu.' : 'Vēl nav pabeigtu uzdevumu.',
        })}
      </section>
      <section class="box">
        <h2>Man piešķirtie projektu uzdevumi</h2>
        ${taskList(filterTasks(assigned, homeChoice), {
          showProject: true,
          emptyText: 'Projektos jums nekas nav piešķirts.',
        })}
      </section>`;
    listenToFilters(lists, homeChoice, draw);
    listenToTasks(lists, all, homePage);
  };
  draw();
}

// projekti

async function projectsPage() {
  const main = layout('<p class="loading">Ielādē...</p>');
  let projects;
  try {
    ({ projects } = await api('GET', '/projects'));
  } catch (error) {
    main.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const rows = projects.map((project) => `
    <li>
      <a href="#/projekti/${project.id}"><b>${esc(project.name)}</b></a>
      ${project.description ? `<p class="description">${esc(project.description)}</p>` : ''}
      <div class="info">
        ${project.role === 'owner' ? 'jūs esat īpašnieks' : 'īpašnieks: ' + esc(project.owner)},
        dalībnieki: ${project.members}, pabeigti ${project.done} no ${project.tasks}
      </div>
    </li>`).join('');

  main.innerHTML = `
    <h1>Projekti</h1>

    <details class="box" ${projects.length ? '' : 'open'}>
      <summary>+ Jauns projekts</summary>
      <form id="new-project" novalidate>
        <p class="form-error" data-error="form"></p>
        <label>Nosaukums <input name="name" maxlength="100" required></label>
        <small class="field-error" data-error="name"></small>
        <label>Apraksts <textarea name="description" rows="2" maxlength="2000"></textarea></label>
        <small class="field-error" data-error="description"></small>
        <div class="buttons"><button type="submit">Izveidot</button></div>
      </form>
    </details>

    <section class="box">
      ${projects.length ? `<ul class="projects">${rows}</ul>` : '<p class="empty">Jums vēl nav neviena projekta.</p>'}
    </section>`;

  const form = main.querySelector('#new-project');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const { project } = await api('POST', '/projects', formData(form));
      showMessage('Projekts izveidots.');
      location.hash = `#/projekti/${project.id}`;
    } catch (error) {
      showErrors(form, error);
    }
  });
}

const projectChoice = { show: 'active', priority: '', sort: 'date', assignee: '' };

async function projectPage(id) {
  const main = layout('<p class="loading">Ielādē...</p>');
  let data;
  try {
    data = await api('GET', `/projects/${id}`);
  } catch (error) {
    main.innerHTML = `<p class="empty">${esc(error.message)} <a href="#/projekti">Atpakaļ uz projektiem</a></p>`;
    return;
  }

  const { project, myRole, members, invitations, tasks } = data;
  const isOwner = myRole === 'owner';
  const reload = () => projectPage(id);
  const count = (done) => tasks.filter((task) => task.completed === done).length;

  const memberList = members.map((member) => `
    <li>
      <span>
        ${esc(member.name)}${member.id === me.id ? ' (jūs)' : ''}
        <small>${member.role === 'owner' ? 'īpašnieks' : 'dalībnieks'}, ${esc(member.email)}</small>
      </span>
      ${isOwner && member.role !== 'owner' ? `<button class="danger small" data-remove="${member.id}" data-name="${esc(member.name)}">Izņemt</button>` : ''}
    </li>`).join('');

  const invitationList = invitations.map((invitation) => `
    <li>
      <span>${esc(invitation.name)} <small>${esc(invitation.email)}, gaida atbildi</small></span>
      <button class="secondary small" data-cancel="${invitation.id}">Atsaukt</button>
    </li>`).join('');

  main.innerHTML = `
    <p><a href="#/projekti">⇤ Projekti</a></p>
    <div class="page-top">
      <h1>${esc(project.name)}</h1>
      <div>
        ${isOwner
          ? '<button class="secondary" id="edit-project">Labot</button> <button class="danger" id="delete-project">Dzēst projektu</button>'
          : '<button class="danger" id="leave-project">Pamest projektu</button>'}
      </div>
    </div>
    ${project.description ? `<p class="description">${esc(project.description)}</p>` : ''}

    <section class="box">
      <div class="page-top">
        <h2>Uzdevumi</h2>
        <button id="new-task">+ Jauns uzdevums</button>
      </div>
      <div id="project-tasks"></div>
    </section>

    <section class="box">
      <h2>Dalībnieki (${members.length})</h2>
      <ul class="people">${memberList}</ul>
      ${isOwner ? `
        <form id="invite" novalidate>
          <label>Uzaicināt pēc e-pasta</label>
          <div class="inline-form">
            <input name="email" type="email" placeholder="vards@epasts.lv" aria-label="E-pasts" required>
            <button type="submit">Uzaicināt</button>
          </div>
          <small class="field-error" data-error="email"></small>
        </form>
        ${invitations.length ? `<h3>Uzaicināti</h3><ul class="people">${invitationList}</ul>` : ''}`
      : ''}
    </section>`;

  const taskBox = main.querySelector('#project-tasks');
  const draw = () => {
    taskBox.innerHTML = filterBar(projectChoice, { counts: { active: count(false), done: count(true) }, withAssignee: true }) +
      taskList(filterTasks(tasks, projectChoice), { emptyText: 'Šeit nav neviena uzdevuma.' });
    listenToFilters(taskBox, projectChoice, draw);
    listenToTasks(taskBox, tasks, reload, members);
  };
  draw();

  main.querySelector('#new-task').addEventListener('click', () =>
    openTaskForm({ projectId: project.id, members, onSaved: reload }));

  if (!isOwner) {
    main.querySelector('#leave-project').addEventListener('click', async () => {
      if (!confirm(`Pamest projektu "${project.name}"?`)) return;
      await api('DELETE', `/projects/${project.id}/members/${me.id}`);
      showMessage('Jūs pametāt projektu.');
      location.hash = '#/projekti';
    });
    return;
  }

  // tālāk viss ir tikai īpašniekam
  const projectDialog = document.querySelector('#project-dialog');
  const projectForm = document.querySelector('#project-form');

  main.querySelector('#edit-project').addEventListener('click', () => {
    clearErrors(projectForm);
    projectForm.elements.name.value = project.name;
    projectForm.elements.description.value = project.description;
    projectForm.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api('PUT', `/projects/${project.id}`, formData(projectForm));
        projectDialog.close();
        showMessage('Projekts saglabāts.');
        reload();
      } catch (error) {
        showErrors(projectForm, error);
      }
    };
    projectDialog.showModal();
  });

  main.querySelector('#delete-project').addEventListener('click', async () => {
    if (!confirm(`Dzēst projektu "${project.name}" kopā ar visiem tā uzdevumiem?`)) return;
    await api('DELETE', `/projects/${project.id}`);
    showMessage('Projekts dzēsts.');
    location.hash = '#/projekti';
  });

  const inviteForm = main.querySelector('#invite');
  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('POST', `/projects/${project.id}/invitations`, formData(inviteForm));
      showMessage('Uzaicinājums nosūtīts.');
      reload();
    } catch (error) {
      showErrors(inviteForm, error);
    }
  });

  main.querySelectorAll('[data-cancel]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api('DELETE', `/projects/${project.id}/invitations/${button.dataset.cancel}`);
      showMessage('Uzaicinājums atsaukts.');
      reload();
    }));

  main.querySelectorAll('[data-remove]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!confirm(`Izņemt ${button.dataset.name} no projekta?`)) return;
      await api('DELETE', `/projects/${project.id}/members/${button.dataset.remove}`);
      showMessage('Dalībnieks izņemts.');
      reload();
    }));
}

// uzaicinājumi

async function invitationsPage() {
  const main = layout('<p class="loading">Ielādē...</p>');
  let invitations;
  try {
    ({ invitations } = await api('GET', '/invitations'));
  } catch (error) {
    main.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const rows = invitations.map((invitation) => `
    <div class="box">
      <h3>${esc(invitation.project)}</h3>
      ${invitation.description ? `<p class="description">${esc(invitation.description)}</p>` : ''}
      <p>Uzaicināja: ${esc(invitation.invitedBy)}</p>
      <button data-accept="${invitation.id}">Pieņemt</button>
      <button class="secondary" data-decline="${invitation.id}">Noraidīt</button>
    </div>`).join('');

  main.innerHTML = `
    <h1>Uzaicinājumi</h1>
    ${rows || '<p class="empty">Jums nav jaunu uzaicinājumu.</p>'}`;

  main.querySelectorAll('[data-accept]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        const { projectId } = await api('POST', `/invitations/${button.dataset.accept}/accept`);
        showMessage('Jūs pievienojāties projektam.');
        location.hash = `#/projekti/${projectId}`;
      } catch (error) {
        showMessage(error.message);
      }
    }));

  main.querySelectorAll('[data-decline]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api('POST', `/invitations/${button.dataset.decline}/decline`);
        showMessage('Uzaicinājums noraidīts.');
        invitationsPage();
      } catch (error) {
        showMessage(error.message);
      }
    }));
}