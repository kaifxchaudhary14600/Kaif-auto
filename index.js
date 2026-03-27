/**
 * ⚡ KAIF MD AUTOFORWARD BOT ⚡
 * Main Entry Point
 * Developed by Mr Wasi (ixxwasi)
 */
require('dotenv').config();
const {
    DisconnectReason,
    jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { wasi_connectSession, wasi_clearSession } = require('./wasilib/session');
const { wasi_connectDatabase, wasi_getGroupSettings, wasi_isDbConnected } = require('./wasilib/database');
const config = require('./wasi');
const qrcode = require('qrcode');

const wasi_app = express();
const wasi_port = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// PLUGIN LOADER (Only 4 specific commands)
// -----------------------------------------------------------------------------
const wasi_plugins = new Map();

function wasi_loadPlugins() {
    const pluginDir = path.join(__dirname, 'wasiplugins');
    if (!fs.existsSync(pluginDir)) return;

    // We only want these specific filenames/commands as per user request
    const requested = ['autoforward.js', 'forward.js', 'gjids.js', 'jid.js', 'uptime.js', 'ping.js', 'menu.js'];
    
    for (const file of requested) {
        const filePath = path.join(pluginDir, file);
        if (fs.existsSync(filePath)) {
            try {
                const plugin = require(`./wasiplugins/${file}`);
                if (plugin.name) {
                    const name = plugin.name.toLowerCase();
                    wasi_plugins.set(name, plugin);
                    if (plugin.aliases && Array.isArray(plugin.aliases)) {
                        plugin.aliases.forEach(alias => wasi_plugins.set(alias.toLowerCase(), plugin));
                    }
                }
            } catch (e) {
                console.error(`Failed to load plugin ${file}:`, e.message);
            }
        }
    }
    console.log(`✅ Loaded ${wasi_plugins.size} core commands.`);
}

// -----------------------------------------------------------------------------
// TEXT REPLACEMENT & CLEANING CONFIG
// -----------------------------------------------------------------------------
const { processAndCleanMessage } = require('./wasilib/cleaner');

// -----------------------------------------------------------------------------
// SESSION STATE
// -----------------------------------------------------------------------------
const sessions = new Map();

// Middleware
wasi_app.use(express.json());
wasi_app.use(express.static(path.join(__dirname, 'public')));

// Keep-Alive Route
wasi_app.get('/ping', (req, res) => res.status(200).send('pong'));

// Dashboard APIs
wasi_app.get('/api/status', async (req, res) => {
    const sessionId = config.sessionId || 'wasi_session';
    const session = sessions.get(sessionId);
    res.json({
        connected: session?.isConnected || false,
        qr: session?.qr || null,
        dbConnected: wasi_isDbConnected()
    });
});

wasi_app.get('/api/config', (req, res) => {
    // Return minimal config for the dashboard (mostly placeholder for now as per user request to streamline)
    res.json({
        sourceJids: [],
        targetJids: [],
        oldTextRegex: [],
        newText: ""
    });
});

wasi_app.post('/api/config', (req, res) => {
    // Stub for saving - for a streamlined bot, user usually manages via .env or commands
    res.json({ success: true });
});

// -----------------------------------------------------------------------------
// SESSION MANAGEMENT
// -----------------------------------------------------------------------------
async function startSession(sessionId) {
    if (sessions.has(sessionId)) {
        const existing = sessions.get(sessionId);
        if (existing.isConnected && existing.sock) return;
        if (existing.sock) {
            existing.sock.ev.removeAllListeners('connection.update');
            existing.sock.end(undefined);
            sessions.delete(sessionId);
        }
    }

    console.log(`🚀 Starting session: ${sessionId}`);
    const sessionState = { sock: null, isConnected: false };
    sessions.set(sessionId, sessionState);

    const { wasi_sock, saveCreds } = await wasi_connectSession(false, sessionId);
    sessionState.sock = wasi_sock;

    // Register listeners immediately to avoid missing events
    console.log(`📡 [${sessionId}] Socket created, listening for events...`);

    wasi_sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                sessionState.qr = await qrcode.toDataURL(qr);
            } catch (e) {
                console.error('Failed to generate QR:', e.message);
            }
        }

        if (connection === 'close') {
            sessionState.isConnected = false;
            sessionState.qr = null;
            const statusCode = (lastDisconnect?.error instanceof Boom) ?
                lastDisconnect.error.output.statusCode : 500;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 440;

            console.log(`Session ${sessionId}: Connection closed, reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(() => startSession(sessionId), 3000);
            } else {
                sessions.delete(sessionId);
                await wasi_clearSession(sessionId);
            }
        } else if (connection === 'open') {
            sessionState.isConnected = true;
            sessionState.qr = null;
            console.log(`✅ ${sessionId}: Connected to WhatsApp`);
        }
    });

    wasi_sock.ev.on('creds.update', saveCreds);

    // -------------------------------------------------------------------------
    // MESSAGE HANDLER
    // -------------------------------------------------------------------------
    wasi_sock.ev.on('messages.upsert', async wasi_m => {
        const wasi_msg = wasi_m.messages[0];
        if (!wasi_msg.message) return;

        const wasi_origin = wasi_msg.key.remoteJid;
        const wasi_sender = jidNormalizedUser(wasi_msg.key.participant || wasi_origin);
        
        const wasi_text = wasi_msg.message.conversation ||
            wasi_msg.message.extendedTextMessage?.text ||
            wasi_msg.message.imageMessage?.caption ||
            wasi_msg.message.videoMessage?.caption ||
            wasi_msg.message.documentMessage?.caption || "";
        
        // 1. AUTO FORWARD LOGIC (Background)
        if (wasi_origin.endsWith('@g.us') && !wasi_msg.key.fromMe) {
            try {
                const groupSettings = await wasi_getGroupSettings(sessionId, wasi_origin);
                if (groupSettings && groupSettings.autoForward && groupSettings.autoForwardTargets?.length > 0) {
                    let relayMsg = processAndCleanMessage(wasi_msg.message);
                    
                    // Unwrap View Once
                    if (relayMsg.viewOnceMessageV2) relayMsg = relayMsg.viewOnceMessageV2.message;
                    if (relayMsg.viewOnceMessage) relayMsg = relayMsg.viewOnceMessage.message;

                    for (const targetJid of groupSettings.autoForwardTargets) {
                        try {
                            await wasi_sock.relayMessage(targetJid, relayMsg, {
                                messageId: wasi_sock.generateMessageTag()
                            });
                        } catch (err) {
                            console.error(`[AUTO-FORWARD] Failed for ${targetJid}:`, err.message);
                        }
                    }
                }
            } catch (err) { }
        }

        // 2. COMMAND HANDLER
        const prefix = '.'; 
        if (wasi_text.trim().startsWith(prefix)) {
            const wasi_parts = wasi_text.trim().slice(prefix.length).trim().split(/\s+/);
            const wasi_cmd_input = wasi_parts[0].toLowerCase();
            const wasi_args = wasi_parts.slice(1);

            if (wasi_plugins.has(wasi_cmd_input)) {
                const plugin = wasi_plugins.get(wasi_cmd_input);
                try {
                    // Minimal Context
                    const isGroup = wasi_origin.endsWith('@g.us');
                    let wasi_isAdmin = false;
                    if (isGroup) {
                        try {
                            const groupMetadata = await wasi_sock.groupMetadata(wasi_origin);
                            const senderMod = groupMetadata.participants.find(p => jidNormalizedUser(p.id) === wasi_sender);
                            wasi_isAdmin = (senderMod?.admin === 'admin' || senderMod?.admin === 'superadmin');
                        } catch (e) { }
                    }

                    // For simplicity, we define isOwner as true if it's the bot itself or listed in config
                    const ownerNum = (config.ownerNumber || '').replace(/\D/g, '');
                    const isOwner = wasi_msg.key.fromMe || (ownerNum && wasi_sender.includes(ownerNum));

                    await plugin.wasi_handler(wasi_sock, wasi_origin, {
                        wasi_sender,
                        wasi_msg,
                        wasi_args,
                        sessionId,
                        wasi_text,
                        wasi_isGroup: isGroup,
                        wasi_isAdmin,
                        wasi_isOwner: isOwner,
                        wasi_isSudo: isOwner,
                        wasi_plugins
                    });
                } catch (err) {
                    console.error(`Error in plugin ${wasi_cmd_input}:`, err.message);
                }
            }
        }
    });
}

// -----------------------------------------------------------------------------
// MAIN STARTUP
// -----------------------------------------------------------------------------
async function main() {
    // 1. Start Dashboard Server IMMEDIATELY (Prevents Heroku timeout)
    wasi_app.listen(wasi_port, () => {
        console.log(`🌐 Dashboard running on port ${wasi_port}`);
    });

    // 2. Load Core Commands
    wasi_loadPlugins();

    // 3. Initialize Bot in Background
    (async () => {
        try {
            // Connect Database
            if (config.mongoDbUrl) {
                const dbResult = await wasi_connectDatabase(config.mongoDbUrl);
                if (dbResult) console.log('✅ Database connected');
            }

            // Start default session
            const sessionId = config.sessionId || 'wasi_session';
            await startSession(sessionId);
        } catch (err) {
            console.error('❌ Initialization Error:', err);
        }
    })();
}

main();
