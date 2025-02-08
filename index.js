const mineclayer = require('mineflayer');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require("cors");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware to parse JSON
app.use(express.json());
app.use(cors()); // Allow all origins (unsafe for production)

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Also serve the entire plugins folder (for static assets)
app.use('/plugins', express.static(path.join(__dirname, 'plugins')));

// -----------------------------
// Global Variables & Settings
// -----------------------------
const botsConfigPath = path.join(__dirname, 'bots.json');
let botsConfig = [];

// Load bots configuration (if file exists)
try {
  botsConfig = JSON.parse(fs.readFileSync(botsConfigPath, 'utf8'));
  console.log(`Loaded ${botsConfig.length} bot configuration(s).`);
} catch (err) {
  console.warn('bots.json not found or invalid, starting with an empty configuration.');
}

// Object to hold running bot instances (keyed by username)
const bots = {};

/// -----------------------------
// Plugin Loader
// -----------------------------
const plugins = {}; // Store plugins by folder name
const pluginsDir = path.join(__dirname, 'plugins');
if (fs.existsSync(pluginsDir)) {
  fs.readdirSync(pluginsDir).forEach((pluginFolder) => {
    const pluginPath = path.join(pluginsDir, pluginFolder);
    if (fs.statSync(pluginPath).isDirectory()) {
      const configPath = path.join(pluginPath, 'plugin.json');
      const codePath = path.join(pluginPath, 'index.js');
      if (fs.existsSync(configPath) && fs.existsSync(codePath)) {
        try {
          const pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const pluginModule = require(codePath);
plugins[pluginFolder] = {
  config: pluginConfig,
  module: pluginModule,
  folder: pluginFolder,
  path: pluginPath
};

// Wait for app to be initialized before loading plugins
setTimeout(() => {
    Object.keys(plugins).forEach(pluginFolder => {
        const { config, module } = plugins[pluginFolder];

        if (config.alwaysLoaded === true) {
            try {
                console.log(`Always loading plugin "${config.name}" from folder "${pluginFolder}".`);
                if (app) {
                    module.init(app); // ✅ Ensuring app exists before calling init
                } else {
                    console.error(`❌ Error: Express app is not initialized for plugin "${config.name}"`);
                }
            } catch (err) {
                console.error(`Error initializing always-loaded plugin "${config.name}":`, err);
            }
        }
    });
}, 100); // Slight delay to ensure app is ready



          console.log(`Loaded plugin "${pluginConfig.name}" from folder "${pluginFolder}".`);
        } catch (err) {
          console.error(`Error loading plugin from folder "${pluginFolder}":`, err);
        }
      } else {
        console.warn(`Skipping folder "${pluginFolder}": Missing plugin.json or index.js`);
      }

      // Serve the UI for each plugin under its plugin name
      const uiPath = path.join(pluginPath, 'ui'); // Assuming each plugin has a 'ui' folder
      if (fs.existsSync(uiPath)) {
        app.use(`/${pluginFolder}`, express.static(uiPath)); // Serve UI from plugin name URL
        console.log(`Serving UI for plugin "${pluginFolder}" from URL "/${pluginFolder}"`);
      }
    }
  });
} else {
  console.warn('Plugins directory does not exist.');
}

// -----------------------------
// Function to Create and Initialize a Bot
// -----------------------------
function createBot(config) {
  const bot = mineclayer.createBot({
    host: config.server,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: 'offline' // For demo purposes; use proper auth in production
  });

  bot.on('login', () => {
    console.log(`${config.username} logged in to ${config.server}:${config.port}`);
    bots[config.username] = { ...config, status: 'online' }; // Track bot status

    // Emit bot status to clients via socket.io
    io.emit('botStatus', bots);

    if (config.password) {
      setTimeout(() => {
        bot.chat(`/login ${config.password}`);
      }, 1000);
    }
    if (Array.isArray(config.enabledPlugins)) {
      config.enabledPlugins.forEach(pluginName => {
        if (plugins[pluginName]) {
          try {
            plugins[pluginName].module.init(bot, config);
            console.log(`Plugin "${plugins[pluginName].config.name}" initialized for ${config.username}`);
          } catch (err) {
            console.error(`Error initializing plugin "${pluginName}" for ${config.username}:`, err);
          }
        } else {
          console.warn(`Plugin "${pluginName}" not found.`);
        }
      });
    }
  });

  bot.on('error', err => console.error(`Bot ${config.username} error:`, err));
  bot.on('end', () => {
    console.log(`Bot ${config.username} disconnected.`);
    if (bots[config.username]) {
      bots[config.username].status = 'offline'; // Update bot status to offline
      // Emit updated bot status to clients via socket.io
      io.emit('botStatus', bots);
    }
    delete bots[config.username];
  });

  return bot;
}

// -----------------------------
// API Endpoints
// -----------------------------

// GET all bot configurations
app.get('/api/bots', (req, res) => {
  res.json(botsConfig);
});

// POST add a new bot configuration
app.post('/api/bots', (req, res) => {
  const newBotConfig = req.body;
  botsConfig.push(newBotConfig);
  fs.writeFileSync(botsConfigPath, JSON.stringify(botsConfig, null, 2));
  res.json({ success: true, config: newBotConfig });
});

// POST start a bot by username
app.post('/api/bots/start', (req, res) => {
  const { username } = req.body;
  const config = botsConfig.find(b => b.username === username);
  if (!config) return res.status(404).json({ error: 'Bot configuration not found' });
  if (bots[username]) return res.status(400).json({ error: 'Bot already running' });
  const bot = createBot(config);
  bots[username] = bot;
  res.json({ success: true, message: `Bot ${username} started` });
});

// POST stop a running bot by username
app.post('/api/bots/stop', (req, res) => {
  const { username } = req.body;
  const bot = bots[username];
  if (bot) {
    bot.quit();
    delete bots[username];
    res.json({ success: true, message: `Bot ${username} stopped` });
  } else {
    res.status(404).json({ error: 'Bot not running' });
  }
});

// -----------------------------
// Plugin API Endpoints
// -----------------------------

// GET all available plugins (with metadata)
app.get('/api/plugins', (req, res) => {
  const pluginList = Object.keys(plugins).map(key => ({
    folder: key,
    ...plugins[key].config
  }));
  res.json(pluginList);
});

// GET enabled plugins for a specific bot by username
app.get('/api/bots/:username/plugins', (req, res) => {
  const username = req.params.username;
  const botConfig = botsConfig.find(b => b.username === username);
  if (!botConfig) return res.status(404).json({ error: 'Bot configuration not found' });
  res.json({ enabledPlugins: botConfig.enabledPlugins || [] });
});

// PUT update (enable/disable) the plugins for a specific bot
app.put('/api/bots/:username/plugins', (req, res) => {
  const username = req.params.username;
  const { enabledPlugins } = req.body;
  const botIndex = botsConfig.findIndex(b => b.username === username);
  if (botIndex < 0) return res.status(404).json({ error: 'Bot configuration not found' });
  botsConfig[botIndex].enabledPlugins = enabledPlugins;
  fs.writeFileSync(botsConfigPath, JSON.stringify(botsConfig, null, 2));
  res.json({ success: true, enabledPlugins });
});


const axios = require('axios');
const unzipper = require('unzipper');


const { exec } = require('child_process');

const reposPath = path.join(__dirname, 'repos.json');
const installedPluginsPath = path.join(__dirname, 'installed_plugins.json');

app.use(express.json());

let repos = [];

// Load repos from JSON
try {
  repos = JSON.parse(fs.readFileSync(reposPath, 'utf8'));
} catch (err) {
  console.warn('repos.json not found or invalid, starting with an empty configuration.');
}

// Load installed plugins
function loadInstalledPlugins() {
  try {
    return JSON.parse(fs.readFileSync(installedPluginsPath, 'utf8'));
  } catch (err) {
    return []; // Return empty if file is missing or invalid
  }
}

// Save installed plugins
function saveInstalledPlugins(installedPlugins) {
  fs.writeFileSync(installedPluginsPath, JSON.stringify(installedPlugins, null, 2));
}

// ----------------------
// API to Get Installed Plugins
// ----------------------
app.get('/api/plugins/installed', (req, res) => {
  const installedPlugins = loadInstalledPlugins();
  res.json(installedPlugins);
});

// ----------------------
// API to Get All Plugins from Repos
// ----------------------
app.get('/api/plugin-list', async (req, res) => {
  const allPlugins = [];
  for (const repo of repos) {
    try {
      const response = await axios.get(`${repo.repoUrl}`);
      const plugins = response.data.plugins.map(plugin => ({
        ...plugin,
        repoName: repo.repoName
      }));
      allPlugins.push(...plugins);
    } catch (err) {
      console.error(`Failed to fetch plugins from ${repo.repoUrl}: ${err.message}`);
    }
  }
  res.json(allPlugins);
});

// ----------------------
// API to Install Plugin
// ----------------------
app.post('/api/plugins/install', async (req, res) => {
  const { pluginId, pluginName, pluginUrl } = req.body;
  
  let pluginData;
  
  // Loop through each repo to find the plugin
  for (const repo of repos) {
    console.log('Checking repo:', repo);

    try {
      // Fetch the plugin data from the repo URL
      const response = await axios.get(repo.repoUrl); // Fetch plugins.json from the repo URL

      // Log the fetched data to debug
      console.log('Fetched repo data:', response.data);

      // Now access the plugins from the fetched data
      if (response.data && response.data.plugins) {
        const foundPlugin = response.data.plugins.find(p => p.pluginId === pluginId || p.pluginName === pluginName);
        if (foundPlugin) {
          pluginData = foundPlugin;
          break; // Stop searching once the plugin is found
        }
      } else {
        console.warn(`Repo data missing plugins array: ${repo.repoName}`);
      }
    } catch (error) {
      console.error(`Error fetching plugin data from ${repo.repoUrl}:`, error);
      return res.status(500).json({ error: 'Error fetching plugin data', details: error.message });
    }
  }

  if (!pluginData) {
    return res.status(404).json({ error: 'Plugin not found in repos' });
  }

  // Get the plugin folder name directly from the repo data
  const pluginFolder = pluginData.folder;

  let installedPlugins = loadInstalledPlugins();

  // Check if plugin is already installed
  if (installedPlugins.some(p => p.pluginId === pluginId)) {
    return res.status(400).json({ error: 'Plugin is already installed' });
  }

  const pluginPath = path.join(pluginsDir, pluginFolder);

  try {
    // Download the plugin zip file
    const response = await axios({
      method: 'get',
      url: pluginUrl,
      responseType: 'stream'
    });

    // Unzip and save the plugin files
    response.data.pipe(unzipper.Extract({ path: pluginsDir }))
      .on('close', () => {
        console.log(`Plugin "${pluginFolder}" installed successfully.`);

        // Save installed plugin
        installedPlugins.push({ pluginId, pluginFolder });
        saveInstalledPlugins(installedPlugins);

        res.json({ success: true, message: `Plugin "${pluginFolder}" installed`, plugins: installedPlugins });
      })
      .on('error', (err) => {
        console.error('Error extracting plugin:', err);
        res.status(500).json({ error: 'Error extracting plugin', details: err.message });
      });
  } catch (err) {
    console.error('Error downloading plugin:', err);
    res.status(500).json({ error: 'Error downloading plugin', details: err.message });
  }
});

// ----------------------
// API to Uninstall Plugin
// ----------------------
app.post('/api/plugins/uninstall', (req, res) => {
  const { pluginId } = req.body;

  let installedPlugins = loadInstalledPlugins();
  const pluginIndex = installedPlugins.findIndex(p => p.pluginId === pluginId);

  if (pluginIndex === -1) {
    return res.status(404).json({ error: 'Plugin not found' });
  }

  const pluginFolder = installedPlugins[pluginIndex].pluginFolder;
  const pluginPath = path.join(pluginsDir, pluginFolder);

  if (fs.existsSync(pluginPath)) {
    fs.rmSync(pluginPath, { recursive: true, force: true });
    console.log(`Plugin "${pluginFolder}" uninstalled successfully.`);

    // Remove from installed plugins list
    installedPlugins.splice(pluginIndex, 1);
    saveInstalledPlugins(installedPlugins);

    res.json({ success: true, message: `Plugin "${pluginFolder}" uninstalled`, plugins: installedPlugins });
  } else {
    res.status(404).json({ error: 'Plugin folder not found' });
  }
});

// API to Reload Plugins
app.post('/api/plugins/reload', (req, res) => {
  // Clear the plugins object to unload current plugins
  Object.keys(plugins).forEach(pluginFolder => {
    delete plugins[pluginFolder];
  });

  // Reload all plugins from the plugins directory
  if (fs.existsSync(pluginsDir)) {
    fs.readdirSync(pluginsDir).forEach((pluginFolder) => {
      const pluginPath = path.join(pluginsDir, pluginFolder);
      if (fs.statSync(pluginPath).isDirectory()) {
        const configPath = path.join(pluginPath, 'plugin.json');
        const codePath = path.join(pluginPath, 'index.js');
        if (fs.existsSync(configPath) && fs.existsSync(codePath)) {
          try {
            const pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const pluginModule = require(codePath);

            // Save plugin data in the plugins object
            plugins[pluginFolder] = {
              config: pluginConfig,
              module: pluginModule,
              folder: pluginFolder,
              path: pluginPath
            };

            // Initialize always-loaded plugins
            if (pluginConfig.alwaysLoaded === true) {
              if (app) {
                pluginModule.init(app);
              }
            }

            console.log(`Reloaded plugin "${pluginConfig.name}" from folder "${pluginFolder}".`);
          } catch (err) {
            console.error(`Error loading plugin from folder "${pluginFolder}":`, err);
          }
        } else {
          console.warn(`Skipping folder "${pluginFolder}": Missing plugin.json or index.js`);
        }

        // Serve the UI for each plugin under its plugin name
        const uiPath = path.join(pluginPath, 'ui');
        if (fs.existsSync(uiPath)) {
          app.use(`/${pluginFolder}`, express.static(uiPath));
          console.log(`Serving UI for plugin "${pluginFolder}" from URL "/${pluginFolder}"`);
        }
      }
    });
  } else {
    console.warn('Plugins directory does not exist.');
  }

  // Return the reloaded list of plugins
  const pluginList = Object.keys(plugins).map(key => ({
    folder: key,
    ...plugins[key].config
  }));

  res.json(pluginList);  // Return the list of plugins
});

// -----------------------------
// Real-Time Socket.io Updates (Optional)
// -----------------------------
io.on('connection', (socket) => {
  console.log('A UI client connected.');
  socket.emit('botStatus', bots); // Send the current bot status to the client
});

// -----------------------------
// Start the Server
// -----------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});