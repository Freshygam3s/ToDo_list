// visi pieprasījumi serverim iet caur šo funkciju

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
