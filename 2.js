// index.js
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

// OR allow specific origins
//app.use(cors({ origin: "http://localhost:5173" }));



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

// -----------------------------
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
          console.log(`Loaded plugin "${pluginConfig.name}" from folder "${pluginFolder}".`);
        } catch (err) {
          console.error(`Error loading plugin from folder "${pluginFolder}":`, err);
        }
      } else {
        console.warn(`Skipping folder "${pluginFolder}": Missing plugin.json or index.js`);
      }
    }
  });
} else {
  console.warn('Plugins directory does not exist.');
}

// -----------------------------
// Dynamic Route to Load a Plugin UI (case-insensitive)
// -----------------------------
app.get('/plugin-ui/:pluginName', (req, res) => {
  const reqName = req.params.pluginName.toLowerCase();
  let foundPlugin = null;
  for (const key in plugins) {
    if (key.toLowerCase() === reqName) {
      foundPlugin = plugins[key];
      break;
    }
  }
  if (foundPlugin && foundPlugin.config.ui) {
    const uiPath = path.join(foundPlugin.path, foundPlugin.config.ui);
    return res.sendFile(uiPath);
  }
  res.status(404).send("Plugin UI not found");
});

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
// Expected body: { username, server, port, version, password, enabledPlugins }
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

// -----------------------------
// Socket.io for Real-Time Updates (Optional)
// -----------------------------
io.on('connection', (socket) => {
  console.log('A UI client connected.');
  // You can emit updates about bot status, plugin events, etc.
});

// -----------------------------
// Serve Documentation Page (Optional)
// -----------------------------
app.get('/documentation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'documentation.html'));
});

// -----------------------------
// Start the Server
// -----------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});