if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');

fetch('/api/me')
  .then((response) => response.json())
  .then((data) => {
    if (data.user) location.href = '/';
  })
  .catch(() => {});

async function send(url, body) {
  let response;
  try {
    response = await fetch('/api' + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'planotajs' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Nav savienojuma ar serveri.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Kaut kas nogāja greizi.');
    error.fields = data.fields || null;
    throw error;
  }
  return data;
}

function showErrors(form, error) {
  form.querySelectorAll('[data-error]').forEach((place) => (place.textContent = ''));
  form.querySelectorAll('.invalid').forEach((field) => field.classList.remove('invalid'));

  const fields = error.fields || {};
  for (const [name, text] of Object.entries(fields)) {
    form.querySelector(`[data-error="${name}"]`).textContent = text;
    form.elements[name]?.classList.add('invalid');
  }
  if (!Object.keys(fields).length) form.querySelector('[data-error="form"]').textContent = error.message;
  form.querySelector('.invalid')?.focus();
}

const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm));
  try {
    await send('/login', data);
    location.href = '/';
  } catch (error) {
    showErrors(loginForm, error);
  }
});

registerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(registerForm));
  if (data.password !== data.password2) {
    return showErrors(registerForm, { fields: { password2: 'Paroles nesakrīt.' } });
  }
  try {
    await send('/register', { name: data.name, email: data.email, password: data.password });
    location.href = '/';
  } catch (error) {
    showErrors(registerForm, error);
  }
});
