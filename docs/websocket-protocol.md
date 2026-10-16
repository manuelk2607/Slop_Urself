# Realtime protocol

Native WebSocket clients connect to /ws/ABCD with a four-character room code.
Messages are JSON objects with type and optional payload.

## Client messages

createRoom, joinRoom and resumeRoom establish membership. Subsequent commands
leaveRoom, refreshQuota, setRoundCount, setGameOptions, setSharedImage, startGame, sendImage, submitVote, judgeGuesses, finishPreview,
startNextRound, closePhase and extendGame require that membership. Only the host changes the lobby's
round selection (setRoundCount payload.rounds) or starts games/turns;
only the current creator uploads; each other player votes once per video.
setGameOptions accepts payload.options with booleans sharedImage, secretTasks,
guessPrompt, quality auto/quality/economy, mode classic/archive-vote/archive-guess
and phaseSeconds 0/60/120/180/300. Only the host may change these in
LOBBY. Quality changes refresh the round limit before a start can reserve budget.
setSharedImage accepts a prepared PNG/JPEG/WebP data URI in imageBase64 and is
host-only in LOBBY/GAME_OVER, or in IDLE solely to replace a missing/expired
common image. With sharedImage enabled, sendImage ignores a
client-supplied image and uses the stored common image. New rooms require
832x624, 624x832 or 640x640 inputs, validated server-side.
submitVote optionally includes taskPoints/funPoints (both required, 1..5, when
secretTasks is enabled). The rounded average is the ordinary 1..5 vote.
With guessPrompt enabled, guess must be a string of at most 150 characters;
an empty string skips guessing. After all votes, nonempty guesses enter
GUESS_REVIEW. Only the creator can send judgeGuesses with the current
videoNumber and a unique correctPlayerIds array drawn from the submitted
guesses. Each correct guess adds two points exactly once before results.
In a one-player room, finishPreview requires payload.videoNumber matching the
current video and explicit confirmation by the creator. A solo preview has no
automatic completion timer by default and stays open through reconnects and reloads.
Explicit phaseSeconds applies to preview/voting too. A deadline never runs in
GENERATING. The server persists phaseKey/phaseDeadline and broadcasts serverTime;
closePhase requires the current phaseKey and host membership. It skips IDLE or
closes voting/review with missing votes treated as abstentions and unconfirmed
guesses receiving no bonus. Stale commands cannot close a subsequent phase.
Real generation requires configured video storage. A completed AI result is
archived before publishing VOTING; archival failure never publishes a temporary
external URL as a successfully prepared game video.
At GAME_OVER, extendGame requires payload.completedVideo matching the completed
videoNumber (or currentRound for legacy games). One complete additional player
cycle is reserved using fresh shared quota. Replays and duplicate clicks cannot
append another cycle; disconnected members must reconnect or leave first.
Archive modes bypass GPU reservations and submissions entirely. Each complete
cycle needs one distinct saved video per player. In archive-vote all members,
including the rotating curator, may vote. Archive-guess uses the normal
creator-excluded voting/guessing flow with the curator judging guesses.
Only confirmed guessing bonuses affect the replay scoreboard; original video
points and lifetime statistics are not rewritten. archiveResults contains
completed replay ratings for the best-of ranking; archiveAuthor identifies the
original creator. Queued video prompts remain private. Replay extensions are
not supported; create another archive game instead.

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
It restores LOBBY, IDLE, GENERATING, VOTING, GUESS_REVIEW, RESULTS and GAME_OVER
without relying on earlier transition events.
Snapshots are personalized per player. options and sharedImageUrl are public to
members; ownTask is creator-only, ownGuess belongs to its submitting player.
task becomes visible at VOTING. reviewPrompt/reviewGuesses are creator-only in
GUESS_REVIEW; reveal publishes prompt, task and adjudicated guesses only in
RESULTS/GAME_OVER. The task dictionary and private credentials are never sent.

Additional messages: connect, roomCodeConflict, resumeFailed, leftRoom,
roomNotice, errorMsg and generationProgress.

## Recovery

A disconnected session is retained for 15 seconds. A reconnect supplies
resumeRoom with its private sessionId; the previous connection is replaced.
Explicit leave removes the player immediately. A departing creator cancels
their turn, and late generation results cannot overwrite the next turn.
Voting and generation state changes are serialized; completion cannot score
a round twice.
