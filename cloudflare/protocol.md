# Realtime protocol

Native WebSocket clients connect to /ws/ABCD with a four-character room code.
Messages are JSON objects with type and optional payload.

## Client messages

createRoom, joinRoom and resumeRoom establish membership. Subsequent commands
leaveRoom, refreshQuota, setRoundCount, startGame, sendImage, submitVote,
startNextRound and extendGame require that membership. Only the host changes the lobby's
round selection (setRoundCount payload.rounds) or starts games/turns;
only the current creator uploads; each other player votes once per video.
At GAME_OVER, extendGame requires payload.completedVideo matching the completed
videoNumber (or currentRound for legacy games). One complete additional player
cycle is reserved using fresh shared quota. Replays and duplicate clicks cannot
append another cycle; disconnected members must reconnect or leave first.

## Server snapshots

roomCreated, joinedSuccess and resumeSuccess return roomId, sessionId and playerId.
sessionId is a private resume credential. playerId is stable across connections
and is used for scores, authors and votes. Session credentials and connection IDs
are never included in public snapshots.

roomDataUpdate is the complete UI state: roomId, gameState, players, hostId,
currentRound, maxRounds, activeCreatorId, activeCreatorName, currentVideoUrl,
lastResult and votedPlayerIds. New games count one full player cycle as a round;
videoNumber is the unique persistence sequence, turnNumber/turnCount identify
the current turn, and nextRound determines whether the next video starts a new
cycle. Lobby quota includes the actual playerCount, aiRoundLimit,
availableGenerations and estimated GPU costs per video and per round.
providers lists the configured five-second generation modes with their costs;
budgetProvider names the cheapest mode used for reservations and sharedQuota
indicates that the modes share one HF account budget, rather than additive quotas.
At GAME_OVER, extensionQuota contains fresh capacity for additional cycles.
Continuing preserves player IDs, scores and roomId, increments maxRounds by one,
and resumes IDLE with a new unique videoNumber. Final ranking is cleared in the
database while playing and saved again at the next end, without another game row.
It restores LOBBY, IDLE, GENERATING, VOTING,
RESULTS and GAME_OVER without relying on earlier transition events.

Additional messages: connect, roomCodeConflict, resumeFailed, leftRoom,
roomNotice, errorMsg and generationProgress.

## Recovery

A disconnected session is retained for 15 seconds. A reconnect supplies
resumeRoom with its private sessionId; the previous connection is replaced.
Explicit leave removes the player immediately. A departing creator cancels
their turn, and late generation results cannot overwrite the next turn.
Voting and generation state changes are serialized; completion cannot score
a round twice.
