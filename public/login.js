const form = document.getElementById('accessForm');
const error = document.getElementById('accessError');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pixel-sprite-request': '1' },
      body: JSON.stringify({ accessKey: document.getElementById('accessKey').value })
    });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || '连接失败'); }
    location.replace('/');
  } catch (cause) {
    error.textContent = cause.message;
    button.disabled = false;
  }
});
