module.exports = {
    name: "autoforward",

    async execute(sock, m, sessionId) {
        try {
            const msg = m.messages?.[0];
            if (!msg) return;

            const origin = msg.key.remoteJid;

            // Check cache first, then DB
            let globalCfg = _getCachedGlobalConfig(sessionId);
            if (!globalCfg) {
                globalCfg = await wasi_getGlobalAutoForward(sessionId);
                if (globalCfg) _setCachedGlobalConfig(sessionId, globalCfg);
            }

            if (!globalCfg?.enabled) return;
            if (!globalCfg.sourceJids?.length || !globalCfg.targetJids?.length) return;

            if (!globalCfg.sourceJids.includes(origin)) return;

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

            for (const jid of globalCfg.targetJids) {
                forwardQueue.enqueue(sock, jid, relayMsg, origin);
            }

        } catch (err) {
            console.error("❌ Autoforward error:", err);
        }
    }
};
