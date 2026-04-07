async function handleAutoForward({ sock, msg, origin, sessionId })
// Check cache first, then DB
    let globalCfg = _getCachedGlobalConfig(sessionId);
    if (!globalCfg) {
        globalCfg = await wasi_getGlobalAutoForward(sessionId);
        if (globalCfg) _setCachedGlobalConfig(sessionId, globalCfg);
    }

    if (!globalCfg?.enabled) return;
    if (!globalCfg.sourceJids?.length || !globalCfg.targetJids?.length) return;

    // Check if this message comes from a configured source JID
    if (!globalCfg.sourceJids.includes(origin)) return;

    // Process and clean the message ONCE — pass globalCfg so caption/timestamp apply
    const relayMsg = processAndCleanMessage(msg.message, globalCfg);
    if (!relayMsg) return;

    const isMedia = relayMsg.imageMessage || relayMsg.videoMessage ||
        relayMsg.documentMessage || relayMsg.audioMessage || relayMsg.stickerMessage;
    const isText = relayMsg.conversation || relayMsg.extendedTextMessage;
    if (!isMedia && !isText) return;

    // Enqueue each target — returns IMMEDIATELY
    for (const jid of globalCfg.targetJids) {
        forwardQueue.enqueue(sock, jid, relayMsg, origin);
    }
}
