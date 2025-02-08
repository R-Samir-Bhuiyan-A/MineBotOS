
// Helper function to perform API calls and return JSON
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  return res.json();
}

// -----------------------------
// Bot Management Functions
// -----------------------------
async function fetchBots() {
  const bots = await fetchJSON('/api/bots');
  const botsContainer = document.getElementById('bots');
  botsContainer.innerHTML = '';
  const botSelect = document.getElementById('botSelect');
  botSelect.innerHTML = '<option value="">-- Select a Bot --</option>';
  bots.forEach(bot => {
    // Create a responsive card for each bot
    const botCard = document.createElement('div');
    botCard.className = 'card mb-2 animate__animated animate__fadeInUp';
    botCard.innerHTML = `
      <div class="card-body">
        <h5 class="card-title">${bot.username}</h5>
        <p class="card-text">${bot.server}:${bot.port}</p>
        <button class="btn btn-success btn-sm" onclick="startBot('${bot.username}')">Start</button>
        <button class="btn btn-danger btn-sm" onclick="stopBot('${bot.username}')">Stop</button>
      </div>
    `;
    botsContainer.appendChild(botCard);
    
    // Populate the bot selection drop-down
    const option = document.createElement('option');
    option.value = bot.username;
    option.textContent = `${bot.username} (${bot.server}:${bot.port})`;
    botSelect.appendChild(option);
  });
}

async function startBot(username) {
  await fetchJSON('/api/bots/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  fetchBots();
}

async function stopBot(username) {
  await fetchJSON('/api/bots/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  fetchBots();
}

document.getElementById('botForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const config = {
    username: formData.get('username'),
    server: formData.get('server'),
    port: parseInt(formData.get('port'), 10),
    version: formData.get('version'),
    password: formData.get('password'),
    enabledPlugins: formData.get('enabledPlugins')
      .split(',')
      .map(p => p.trim())
      .filter(p => p)
  };
  await fetchJSON('/api/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  e.target.reset();
  fetchBots();
});

// -----------------------------
// Plugin Management Functions
// -----------------------------
async function fetchAllPlugins() {
  return await fetchJSON('/api/plugins');
}

async function fetchEnabledPlugins(botUsername) {
  if (!botUsername) return [];
  const data = await fetchJSON(`/api/bots/${botUsername}/plugins`);
  return data.enabledPlugins || [];
}

async function updateBotPlugins(botUsername, enabledPlugins) {
  await fetchJSON(`/api/bots/${botUsername}/plugins`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabledPlugins })
  });
}

async function loadPluginCards() {
  const botSelect = document.getElementById('botSelect');
  const botUsername = botSelect.value;
  if (!botUsername) {
    alert('Please select a bot first.');
    return;
  }
  const enabledPlugins = await fetchEnabledPlugins(botUsername);
  const allPlugins = await fetchAllPlugins();
  const cardsContainer = document.getElementById('pluginCards');
  cardsContainer.innerHTML = '';
  
  allPlugins.forEach(plugin => {
    const isEnabled = enabledPlugins.includes(plugin.folder);
    const cardCol = document.createElement('div');
    cardCol.className = 'col-md-4 mb-3';
    cardCol.innerHTML = `
      <div class="card plugin-card ${isEnabled ? 'border-success' : 'border-danger'} animate__animated animate__fadeInUp">
        <div class="card-body">
          <h5 class="card-title">${plugin.name}</h5>
          <p class="card-text">${plugin.description}</p>
          <button data-folder="${plugin.folder}" class="btn ${isEnabled ? 'btn-danger' : 'btn-success'} toggle-plugin">
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>
    `;
    cardsContainer.appendChild(cardCol);
  });
  
  updatePluginNavbar(enabledPlugins);
}

function updatePluginNavbar(enabledPlugins) {
  const navbar = document.getElementById('pluginNavbar');
  navbar.innerHTML = '';
  if (enabledPlugins.length === 0) {
    navbar.innerHTML = '<li class="nav-item"><span class="nav-link">No plugins enabled</span></li>';
    return;
  }
  enabledPlugins.forEach(folder => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = "#";
    a.textContent = folder;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      loadPluginUI(folder);
    });
    li.appendChild(a);
    navbar.appendChild(li);
  });
}

async function loadPluginUI(pluginFolder) {
  const container = document.getElementById('pluginContent');
  container.innerHTML = `<iframe src="/plugin-ui/${pluginFolder}" style="width: 100%; height: 400px;" class="animate__animated animate__fadeIn"></iframe>`;
}

document.getElementById('pluginCards').addEventListener('click', async (e) => {
  if (e.target.classList.contains('toggle-plugin')) {
    const folder = e.target.getAttribute('data-folder');
    const botUsername = document.getElementById('botSelect').value;
    let enabledPlugins = await fetchEnabledPlugins(botUsername);
    if (enabledPlugins.includes(folder)) {
      enabledPlugins = enabledPlugins.filter(p => p !== folder);
    } else {
      enabledPlugins.push(folder);
    }
    await updateBotPlugins(botUsername, enabledPlugins);
    loadPluginCards();
  }
});

document.getElementById('loadBotPlugins').addEventListener('click', loadPluginCards);

// Initial load
fetchBots();
