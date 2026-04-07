console.log("🔥 Global Autoforward Loaded");

module.exports = (sock, sessionId) => {

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages?.[0];
            if (!msg || !msg.message) return;

            const origin = msg.key.remoteJid;

            // 🧠 Load config (cache → DB)
            let globalCfg = _getCachedGlobalConfig(sessionId);
            if (!globalCfg) {
                globalCfg = await wasi_getGlobalAutoForward(sessionId);
                if (globalCfg) _setCachedGlobalConfig(sessionId, globalCfg);
            }

            if (!globalCfg?.enabled) return;
            if (!globalCfg.sourceJids?.length || !globalCfg.targetJids?.length) return;

            // ❌ Ignore non-source chats
            if (!globalCfg.sourceJids.includes(origin)) return;

            // 🔄 Process message
            const relayMsg = processAndCleanMessage(msg.message, globalCfg);
            if (!relayMsg) return;

            const isMedia =
                relayMsg.imageMessage ||
                relayMsg.videoMessage ||
                relayMsg.documentMessage ||
                relayMsg.audioMessage ||
                relayMsg.stickerMessage;

            const isText =
                relayMsg.conversation ||
                relayMsg.extendedTextMessage;

            if (!isMedia && !isText) return;

            // 🚀 Forward globally
            for (const jid of globalCfg.targetJids) {
                try {
                    forwardQueue.enqueue(sock, jid, relayMsg, origin);
                } catch (err) {
                    console.error("❌ Forward error:", err);
                }
            }

        } catch (err) {
            console.error("❌ Global AF Error:", err);
        }
    });

};
