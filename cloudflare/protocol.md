# Realtime protocol

The hosted Cloudflare version uses native WebSockets with JSON messages.

Each client message:

```json
{
  "type": "createRoom",
  "payload": {}
}
```

Each server message:

```json
{
  "type": "roomCreated",
  "payload": {}
}
```

## Event mapping

| Current Socket.IO event | Worker WebSocket event | Direction | Notes |
| --- | --- | --- | --- |
| `createRoom` | `createRoom` | client -> room | Creates a room in the Durable Object. |
| `roomCreated` | `roomCreated` | room -> client | Returns room code and session id. |
| `joinRoom` | `joinRoom` | client -> room | Adds a player before game start. |
| `joinedSuccess` | `joinedSuccess` | room -> client | Confirms join. |
| `resumeRoom` | `resumeRoom` | client -> room | Restores a session after reload. |
| `resumeSuccess` | `resumeSuccess` | room -> client | Confirms resume. |
| `resumeFailed` | `resumeFailed` | room -> client | Clears local session. |
| `roomDataUpdate` | `roomDataUpdate` | room -> all | Sends player list, host, state, round count. |
| `startGame` | `startGame` | client -> room | Host-only. |
| `showCreateScreen` | `showCreateScreen` | room -> all | Announces active creator. |
| `sendImage` | `sendImage` | client -> room | Triggers AI generation. |
| `generationStarted` | `generationStarted` | room -> all | Shows loading UI. |
| `showVotingScreen` | `showVotingScreen` | room -> all | Sends generated video URL. |
| `submitVote` | `submitVote` | client -> room | Sends 1-5 points. |
| `voteProgress` | `voteProgress` | room -> all | Shows vote count. |
| `showResultsScreen` | `showResultsScreen` | room -> all | Sends round result. |
| `startNextRound` | `startNextRound` | client -> room | Host-only. |
| `showGameOverScreen` | `showGameOverScreen` | room -> all | Sends final standings. |
| `leaveRoom` | `leaveRoom` | client -> room | Removes player. |
| `leftRoom` | `leftRoom` | room -> client | Confirms leaving. |
| `errorMsg` | `errorMsg` | room -> client | Displays error. |

## Remaining migration tasks

1. Add a browser realtime adapter in `script.ts`.
2. Replace Socket.IO calls with adapter calls.
3. Implement Worker-compatible Hugging Face generation.
4. Implement Worker-compatible Neon writes with fetch/serverless driver.
5. Deploy to Cloudflare and set secrets.
