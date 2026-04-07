// 🔥 GLOBAL AUTOFORWARD FINAL

console.log("🔥 Global Autoforward Loaded");

module.exports = (sock, sessionId) => {

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages?.[0];
            if (!msg || !msg.message) return;

            const origin = msg.key.remoteJid;

            console.log("📩 Message from:", origin);

            // 🧠 Load config (cache → DB)
            let globalCfg = _getCachedGlobalConfig(sessionId);
            if (!globalCfg) {
                globalCfg = await wasi_getGlobalAutoForward(sessionId);
                if (globalCfg) _setCachedGlobalConfig(sessionId, globalCfg);
            }

            console.log("⚙️ Config:", globalCfg);

            // ❌ Disabled
            if (!globalCfg?.enabled) {
                console.log("❌ AF Disabled");
                return;
            }

            // ❌ Missing config
            if (!globalCfg.sourceJids?.length || !globalCfg.targetJids?.length) {
                console.log("❌ Missing source/target");
                return;
            }

            // ❌ Not source
            if (!globalCfg.sourceJids.includes(origin)) {
                console.log("❌ Not in source list");
                return;
            }

            console.log("✅ Source matched");

            // 🔄 Process message
            const relayMsg = processAndCleanMessage(msg.message, globalCfg);

            if (!relayMsg) {
                console.log("❌ relayMsg null");
                return;
            }

            // 📦 Type check
            const isMedia =
                relayMsg.imageMessage ||
                relayMsg.videoMessage ||
                relayMsg.documentMessage ||
                relayMsg.audioMessage ||
                relayMsg.stickerMessage;

            const isText =
                relayMsg.conversation ||
                relayMsg.extendedTextMessage;

            if (!isMedia && !isText) {
                console.log("❌ Unsupported message type");
                return;
            }

            console.log("🚀 Forwarding...");

            // 🚀 Forward (DIRECT SEND for testing)
            for (const jid of globalCfg.targetJids) {
                try {
                    await sock.sendMessage(jid, relayMsg);
                    console.log("✅ Sent to:", jid);
                } catch (err) {
                    console.error("❌ Send error:", err);
                }
            }

        } catch (err) {
            console.error("❌ Global AF Error:", err);
        }
    });

};
