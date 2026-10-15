// Plānotāja serveris. Palaist ar: node server.js
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import mysqlSession from 'express-mysql-session';
import config from './config.js';
import { createTables, pool, query, queryOne, transaction } from './db.js';

const app = express();
const MySQLStore = mysqlSession(session);

// kļūda, ko var parādīt lietotājam (fields ir kļūdas pie formas laukiem)
class UserError extends Error {
  constructor(message, fields = null, status = 400) {
    super(message);
    this.fields = fields;
    this.status = status;
  }
}

const notFound = (what) => new UserError(`${what} nav atrasts.`, null, 404);
const forbidden = () => new UserError('Jums nav tiesību to darīt.', null, 403);

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
// id no adreses: tikai vesels skaitlis, citādi 0
const toId = (value) => (/^\d{1,10}$/.test(String(value)) ? Number(value) : 0);
const PRIORITIES = ['low', 'medium', 'high'];

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  const year = Number(value.slice(0, 4));
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && year >= 2000 && year <= 2100;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function checkFields(errors) {
  if (Object.keys(errors).length) throw new UserError('Lūdzu, izlabojiet kļūdas formā.', errors);
}

// lai nevar minēt paroles: max 20 mēģinājumi 15 minūtēs no vienas IP
const attempts = new Map();
function limitAttempts(req) {
  const now = Date.now();
  const recent = (attempts.get(req.ip) ?? []).filter((time) => now - time < 15 * 60 * 1000);
  recent.push(now);
  attempts.set(req.ip, recent);
  if (recent.length > 20) throw new UserError('Pārāk daudz mēģinājumu. Pamēģiniet vēlreiz pēc 15 minūtēm.', null, 429);
}

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.use(express.static('public'));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  next();
});

app.use(session({
  name: 'planotajs',
  secret: config.secret,
  store: new MySQLStore({ createDatabaseTable: false }, pool),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict' },
}));

// CSRF: sīkfails ir sameSite, un visiem izmaiņu pieprasījumiem jābūt ar mūsu galveni
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'planotajs') return next(forbidden());
  res.set('Cache-Control', 'no-store');
  next();
});

// laiž tālāk tikai pieslēgušos, req.user = { id, name, email }
async function needLogin(req, res, next) {
  const user = req.session.userId
    ? await queryOne('SELECT id, name, email FROM users WHERE id = ?', [req.session.userId])
    : null;
  if (!user) {
    req.session.userId = null;
    throw new UserError('Lūdzu, pieslēdzieties.', null, 401);
  }
  req.user = user;
  next();
}

function startSession(req, userId) {
  // pēc pieslēgšanās jauns sesijas id
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve();
    });
  });
}

// konts

app.get('/api/me', async (req, res) => {
  const user = req.session.userId
    ? await queryOne('SELECT id, name, email FROM users WHERE id = ?', [req.session.userId])
    : null;
  const invitations = user ? await countInvitations(user.id) : 0;
  res.json({ user, invitations });
});

app.post('/api/register', async (req, res) => {
  limitAttempts(req);
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const errors = {};
  if (!name) errors.name = 'Ievadiet vārdu.';
  else if (name.length > 100) errors.name = 'Vārds var būt ne garāks par 100 zīmēm.';
  if (!email) errors.email = 'Ievadiet e-pastu.';
  else if (!isEmail(email)) errors.email = 'E-pasta adrese nav pareiza.';
  else if (await queryOne('SELECT id FROM users WHERE email = ?', [email])) errors.email = 'Šis e-pasts jau ir reģistrēts.';
  if (password.length < 8) errors.password = 'Parolei jābūt vismaz 8 zīmes garai.';
  else if (!/\d/.test(password)) errors.password = 'Parolē jābūt vismaz vienam ciparam.';
  else if (!/[^A-Za-z0-9\s]/.test(password)) errors.password = 'Parolē jābūt vismaz vienam simbolam (piemēram, ! ? # $).';
  else if (password.length > 128) errors.password = 'Parole var būt ne garāka par 128 zīmēm.';
  checkFields(errors);

  // paroli glabājam tikai kā bcrypt hash
  const hash = await bcrypt.hash(password, 12);
  const result = await query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
  await startSession(req, result.insertId);
  res.status(201).json({ user: { id: result.insertId, name, email } });
});

app.post('/api/login', async (req, res) => {
  limitAttempts(req);
  const email = clean(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const errors = {};
  if (!email) errors.email = 'Ievadiet e-pastu.';
  if (!password) errors.password = 'Ievadiet paroli.';
  checkFields(errors);

  const user = await queryOne('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
  // viena un tā pati kļūda, lai nevar uzzināt, vai tāds lietotājs eksistē
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new UserError('Nepareizs e-pasts vai parole.', null, 401);
  }
  await startSession(req, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('planotajs').json({ ok: true });
  });
});

// izdzēš kontu; viņa uzdevumi, projekti (kur viņš ir īpašnieks), dalība un uzaicinājumi izdzēšas līdzi (ON DELETE CASCADE)
app.delete('/api/me', needLogin, async (req, res, next) => {
  await query('DELETE FROM users WHERE id = ?', [req.user.id]);
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('planotajs').json({ ok: true });
  });
});

// uzdevumi

// uzdevums + projekta nosaukums, atbildīgā un autora vārds un mana loma projektā
// pirmais ? vienmēr ir mans id
const TASK_SQL = `
  SELECT t.*, p.name AS project_name, a.name AS assignee_name, c.name AS creator_name, m.role AS my_role
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users a ON a.id = t.assignee_id
    JOIN users c ON c.id = t.created_by
    LEFT JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?`;

const TASK_ORDER = "ORDER BY t.completed, t.due_date IS NULL, t.due_date, FIELD(t.priority, 'high', 'medium', 'low'), t.id DESC";

// personīgo uzdevumu var mainīt tikai autors, projekta uzdevumu jebkurš projekta dalībnieks
function rights(task, userId) {
  const allowed = task.project_id === null
    ? task.created_by === userId
    : task.my_role === 'owner' || task.my_role === 'member';
  return { canEdit: allowed, canComplete: allowed };
}

function taskJson(task, userId) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.due_date,
    priority: task.priority,
    completed: Boolean(task.completed),
    project: task.project_id ? { id: task.project_id, name: task.project_name } : null,
    assignee: task.assignee_id ? { id: task.assignee_id, name: task.assignee_name } : null,
    author: task.creator_name,
    ...rights(task, userId),
  };
}

// atrod uzdevumu, ja to drīkst redzēt, citādi 404
async function findTask(id, userId) {
  const task = await queryOne(`${TASK_SQL} WHERE t.id = ?`, [userId, id]);
  const visible = task && (task.project_id === null ? task.created_by === userId : task.my_role !== null);
  if (!visible) throw notFound('Uzdevums');
  return task;
}

// pārbauda uzdevuma formu
function readTaskForm(body) {
  const title = clean(body.title);
  const description = clean(body.description);
  const dueDate = clean(body.dueDate) || null;
  const priority = body.priority || 'medium';

  const errors = {};
  if (!title) errors.title = 'Ievadiet nosaukumu.';
  else if (title.length > 200) errors.title = 'Nosaukums var būt ne garāks par 200 zīmēm.';
  if (description.length > 5000) errors.description = 'Apraksts var būt ne garāks par 5000 zīmēm.';
  if (dueDate && !isDate(dueDate)) errors.dueDate = 'Nepareizs datums.';
  if (!PRIORITIES.includes(priority)) errors.priority = 'Izvēlieties prioritāti.';
  checkFields(errors);
  return { title, description, dueDate, priority };
}

// atbildīgajam jābūt projekta dalībniekam (vai nevienam)
async function readAssignee(value, projectId) {
  if (value === null || value === undefined || value === '') return null;
  const id = toId(value);
  const member = id && (await memberRole(projectId, id));
  if (!member) throw new UserError('Lūdzu, izlabojiet kļūdas formā.', { assigneeId: 'Šis lietotājs nav projekta dalībnieks.' });
  return id;
}

// mani uzdevumi un projektos man piešķirtie
app.get('/api/tasks', needLogin, async (req, res) => {
  const me = req.user.id;
  const personal = await query(`${TASK_SQL} WHERE t.project_id IS NULL AND t.created_by = ? ${TASK_ORDER}`, [me, me]);
  const assigned = await query(`${TASK_SQL} WHERE t.assignee_id = ? AND m.user_id IS NOT NULL ${TASK_ORDER}`, [me, me]);
  res.json({
    tasks: personal.map((task) => taskJson(task, me)),
    assigned: assigned.map((task) => taskJson(task, me)),
  });
});

// ja ir projectId, tad tas ir projekta uzdevums
app.post('/api/tasks', needLogin, async (req, res) => {
  const me = req.user.id;
  const form = readTaskForm(req.body);
  let projectId = null;
  let assigneeId = null;

  if (req.body.projectId) {
    projectId = toId(req.body.projectId);
    const role = await memberRole(projectId, me);
    if (!role) throw notFound('Projekts');
    if (role !== 'owner' && role !== 'member') throw forbidden();
    assigneeId = await readAssignee(req.body.assigneeId, projectId);
  }

  const result = await query(
    'INSERT INTO tasks (created_by, project_id, assignee_id, title, description, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [me, projectId, assigneeId, form.title, form.description, form.dueDate, form.priority],
  );
  res.status(201).json({ task: taskJson(await findTask(result.insertId, me), me) });
});

// ja atsūta tikai { completed }, tad tikai atzīmē kā pabeigtu vai nepabeigtu
app.put('/api/tasks/:id', needLogin, async (req, res) => {
  const me = req.user.id;
  const task = await findTask(toId(req.params.id), me);
  const { canEdit, canComplete } = rights(task, me);
  const onlyCompleting = Object.keys(req.body).length === 1 && typeof req.body.completed === 'boolean';

  if (onlyCompleting) {
    if (!canComplete) throw forbidden();
    await query(
      'UPDATE tasks SET completed = ?, completed_at = IF(?, COALESCE(completed_at, NOW()), NULL) WHERE id = ?',
      [req.body.completed ? 1 : 0, req.body.completed ? 1 : 0, task.id],
    );
  } else {
    if (!canEdit) throw forbidden();
    const form = readTaskForm(req.body);
    // ja formā nav atbildīgā lauka (piem. labojot no pārskata), atbildīgais paliek tas pats
    const assigneeId = task.project_id && req.body.assigneeId !== undefined
      ? await readAssignee(req.body.assigneeId, task.project_id)
      : task.assignee_id;
    await query(
      'UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, assignee_id = ? WHERE id = ?',
      [form.title, form.description, form.dueDate, form.priority, assigneeId, task.id],
    );
  }
  res.json({ task: taskJson(await findTask(task.id, me), me) });
});

app.delete('/api/tasks/:id', needLogin, async (req, res) => {
  const task = await findTask(toId(req.params.id), req.user.id);
  if (!rights(task, req.user.id).canEdit) throw forbidden();
  await query('DELETE FROM tasks WHERE id = ?', [task.id]);
  res.json({ ok: true });
});

// projekti

async function memberRole(projectId, userId) {
  const row = await queryOne('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  return row?.role ?? null;
}

// projekts, kurā esmu dalībnieks, citādi 404
async function findProject(id, userId) {
  const project = await queryOne(
    `SELECT p.id, p.name, p.description, m.role AS my_role
       FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
      WHERE p.id = ?`,
    [userId, id],
  );
  if (!project) throw notFound('Projekts');
  return project;
}

function readProjectForm(body) {
  const name = clean(body.name);
  const description = clean(body.description);
  const errors = {};
  if (!name) errors.name = 'Ievadiet projekta nosaukumu.';
  else if (name.length > 100) errors.name = 'Nosaukums var būt ne garāks par 100 zīmēm.';
  if (description.length > 2000) errors.description = 'Apraksts var būt ne garāks par 2000 zīmēm.';
  checkFields(errors);
  return { name, description };
}

app.get('/api/projects', needLogin, async (req, res) => {
  const projects = await query(
    `SELECT p.id, p.name, p.description, m.role, o.name AS owner,
            (SELECT COUNT(*) FROM project_members x WHERE x.project_id = p.id) AS members,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 1) AS done
       FROM projects p
       JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       JOIN users o ON o.id = p.owner_id
      ORDER BY p.name`,
    [req.user.id],
  );
  res.json({ projects });
});

app.post('/api/projects', needLogin, async (req, res) => {
  const form = readProjectForm(req.body);
  const id = await transaction(async (run) => {
    const result = await run('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)', [form.name, form.description, req.user.id]);
    await run("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')", [result.insertId, req.user.id]);
    return result.insertId;
  });
  res.status(201).json({ project: { id } });
});

// viss projekta lapai (uzaicinājumus redz tikai īpašnieks)
app.get('/api/projects/:id', needLogin, async (req, res) => {
  const me = req.user.id;
  const project = await findProject(toId(req.params.id), me);
  const members = await query(
    `SELECT u.id, u.name, u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? ORDER BY m.role = 'owner' DESC, u.name`,
    [project.id],
  );
  const invitations = project.my_role === 'owner'
    ? await query(
      `SELECT i.id, u.name, u.email FROM invitations i JOIN users u ON u.id = i.invitee_id
        WHERE i.project_id = ? AND i.status = 'pending' ORDER BY i.id`,
      [project.id],
    )
    : [];
  const tasks = await query(`${TASK_SQL} WHERE t.project_id = ? ${TASK_ORDER}`, [me, project.id]);

  res.json({
    project: { id: project.id, name: project.name, description: project.description },
    myRole: project.my_role,
    members,
    invitations,
    tasks: tasks.map((task) => taskJson(task, me)),
  });
});

app.put('/api/projects/:id', needLogin, async (req, res) => {
  const project = await findProject(toId(req.params.id), req.user.id);
  if (project.my_role !== 'owner') throw forbidden();
  const form = readProjectForm(req.body);
  await query('UPDATE projects SET name = ?, description = ? WHERE id = ?', [form.name, form.description, project.id]);
  res.json({ ok: true });
});

// uzdevumi, dalībnieki un uzaicinājumi izdzēšas līdzi (ON DELETE CASCADE)
app.delete('/api/projects/:id', needLogin, async (req, res) => {
  const project = await findProject(toId(req.params.id), req.user.id);
  if (project.my_role !== 'owner') throw forbidden();
  await query('DELETE FROM projects WHERE id = ?', [project.id]);
  res.json({ ok: true });
});

// īpašnieks uzaicina citu reģistrētu lietotāju
app.post('/api/projects/:id/invitations', needLogin, async (req, res) => {
  const project = await findProject(toId(req.params.id), req.user.id);
  if (project.my_role !== 'owner') throw forbidden();

  const email = clean(req.body.email).toLowerCase();
  const invitee = isEmail(email) ? await queryOne('SELECT id FROM users WHERE email = ?', [email]) : null;
  let error = null;
  if (!email) error = 'Ievadiet e-pastu.';
  else if (!isEmail(email)) error = 'E-pasta adrese nav pareiza.';
  else if (!invitee) error = 'Lietotājs ar šādu e-pastu nav reģistrēts.';
  else if (invitee.id === req.user.id) error = 'Jūs nevarat uzaicināt sevi.';
  else if (await memberRole(project.id, invitee.id)) error = 'Šis lietotājs jau ir projektā.';
  else if (await queryOne("SELECT id FROM invitations WHERE project_id = ? AND invitee_id = ? AND status = 'pending'", [project.id, invitee.id])) {
    error = 'Šis lietotājs jau ir uzaicināts.';
  }
  if (error) checkFields({ email: error });

  await query('INSERT INTO invitations (project_id, invited_by, invitee_id) VALUES (?, ?, ?)', [project.id, req.user.id, invitee.id]);
  res.status(201).json({ ok: true });
});

// atsaukt uzaicinājumu
app.delete('/api/projects/:id/invitations/:invitationId', needLogin, async (req, res) => {
  const project = await findProject(toId(req.params.id), req.user.id);
  if (project.my_role !== 'owner') throw forbidden();
  const result = await query(
    "UPDATE invitations SET status = 'cancelled', responded_at = NOW() WHERE id = ? AND project_id = ? AND status = 'pending'",
    [toId(req.params.invitationId), project.id],
  );
  if (!result.affectedRows) throw notFound('Uzaicinājums');
  res.json({ ok: true });
});

// īpašnieks izņem kādu, vai dalībnieks pats aiziet
app.delete('/api/projects/:id/members/:userId', needLogin, async (req, res) => {
  const project = await findProject(toId(req.params.id), req.user.id);
  const userId = toId(req.params.userId);
  const leaving = userId === req.user.id;
  if (!leaving && project.my_role !== 'owner') throw forbidden();

  const role = await memberRole(project.id, userId);
  if (!role) throw notFound('Dalībnieks');
  if (role === 'owner') throw new UserError('Īpašnieks nevar pamest savu projektu. To var tikai dzēst.', null, 403);

  await transaction(async (run) => {
    await run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, userId]);
    // viņa uzdevumi paliek, tikai bez atbildīgā
    await run('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?', [project.id, userId]);
  });
  res.json({ ok: true });
});

// uzaicinājumi

async function countInvitations(userId) {
  const row = await queryOne("SELECT COUNT(*) AS count FROM invitations WHERE invitee_id = ? AND status = 'pending'", [userId]);
  return Number(row.count);
}

async function findInvitation(id, userId) {
  const invitation = await queryOne(
    "SELECT * FROM invitations WHERE id = ? AND invitee_id = ? AND status = 'pending'",
    [id, userId],
  );
  if (!invitation) throw notFound('Uzaicinājums');
  return invitation;
}

app.get('/api/invitations', needLogin, async (req, res) => {
  const invitations = await query(
    `SELECT i.id, p.id AS projectId, p.name AS project, p.description, u.name AS invitedBy
       FROM invitations i
       JOIN projects p ON p.id = i.project_id
       JOIN users u ON u.id = i.invited_by
      WHERE i.invitee_id = ? AND i.status = 'pending'
      ORDER BY i.id DESC`,
    [req.user.id],
  );
  res.json({ invitations });
});

app.post('/api/invitations/:id/accept', needLogin, async (req, res) => {
  const invitation = await findInvitation(toId(req.params.id), req.user.id);
  await transaction(async (run) => {
    await run("INSERT IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')", [invitation.project_id, req.user.id]);
    await run("UPDATE invitations SET status = 'accepted', responded_at = NOW() WHERE id = ?", [invitation.id]);
  });
  res.json({ projectId: invitation.project_id });
});

app.post('/api/invitations/:id/decline', needLogin, async (req, res) => {
  const invitation = await findInvitation(toId(req.params.id), req.user.id);
  await query("UPDATE invitations SET status = 'declined', responded_at = NOW() WHERE id = ?", [invitation.id]);
  res.json({ ok: true });
});

// kļūdas

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Šāda adrese neeksistē.' });
});

app.use((err, req, res, next) => {
  if (err instanceof UserError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Nederīgs pieprasījums.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Pieprasījums ir pārāk liels.' });
  console.error(err);
  res.status(500).json({ error: 'Servera kļūda. Lūdzu, mēģiniet vēlreiz.' });
});

// palaišana

try {
  await createTables();
} catch (err) {
  console.error(`Neizdevās savienoties ar MySQL: ${err.message}`);
  console.error('Vispirms izveidojiet datubāzi (MySQL root lietotājs, projekta mapē):');
  console.error('  mysql -u root -p -e "source database.sql"');
  process.exit(1);
}

app.listen(config.port, 'localhost', () => {
  console.log(`Plānotājs darbojas: http://localhost:${config.port}   (apturēt: Ctrl+C)`);
});
