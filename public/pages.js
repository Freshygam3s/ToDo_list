// lapas: pārskats, projekti, viens projekts, uzaicinājumi

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
