// uzdevumu saraksts, filtri un uzdevuma forma

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
      ${task.canEdit || task.canDelete ? `
      <div class="task-buttons">
        ${task.canEdit ? `<button class="secondary small" data-edit="${task.id}">Labot</button>` : ''}
        ${task.canDelete ? `<button class="danger small" data-delete="${task.id}">Dzēst</button>` : ''}
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
      if (!(await askConfirm('Dzēst uzdevumu?', `Uzdevums "${task.title}" tiks izdzēsts.`, 'Jā, dzēst'))) return;
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
