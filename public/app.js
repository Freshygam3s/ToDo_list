const app = document.querySelector('#app');
let me = null;
let invitationCount = 0;

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

document.querySelectorAll('dialog [data-close]').forEach((button) =>
  button.addEventListener('click', () => button.closest('dialog').close()));

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

  if (!me) return (location.href = 'login.html');

  for (const [pattern, page] of pages) {
    const match = hash.match(pattern);
    if (match) return page(...match.slice(1));
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', showPage);
showPage();
