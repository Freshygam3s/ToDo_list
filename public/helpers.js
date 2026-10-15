// mazas palīgfunkcijas, ko izmanto pārējie faili

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
