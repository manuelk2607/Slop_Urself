export interface PersistPlayerInput {
    roomCode: string;
    playerSocketId: string;
    accountId?: string;
    name: string;
    score: number;
    isHost: boolean;
}

export interface FinalStandingInput { playerSocketId: string; name: string; score: number; finalRank: number }
export interface PersistRoundInput {
    roomCode: string;
    roundNumber: number;
    creatorSocketId: string;
    prompt: string;
    videoUrl: string;
    roundPoints: number;
    votes: { voterSocketId: string; points: number }[];
    players?: { id: string; accountId?: string; name: string; score: number }[];
    hostId?: string;
    standings?: FinalStandingInput[];
}

export interface PlayerStats {
    id: string;
    name: string;
    gamesPlayed: number;
    wins: number;
    roundsCreated: number;
    totalScore: number;
    averageScore: number;
    averageReceivedPoints: number;
    votesGiven: number;
    averageVoteGiven: number;
}
export interface StatsOverview {
    gamesPlayed: number;
    completedGames: number;
    roundsPlayed: number;
    votesCast: number;
    videosArchived: number;
    highestScore: number;
}
export interface VideoStats {
    id: string;
    roomDeleted: boolean;
    creatorId: string;
    roomCode: string;
    roundNumber: number;
    creatorName: string;
    prompt: string;
    videoUrl: string;
    roundPoints: number;
    createdAt: string;
}
export interface RoomStats {
    code: string;
    status: string;
    playerCount: number;
    videoCount: number;
    totalPoints: number;
    winnerName: string | null;
    createdAt: string;
}
export interface VideoCreator { id: string; name: string }
export interface SavedVideo extends VideoStats { deleteAfter: string | null }
export interface GameStats { overview: StatsOverview; players: PlayerStats[]; recentVideos: VideoStats[]; videoCreators: VideoCreator[]; rooms: RoomStats[] }
export const emptyStats = (): GameStats => ({
    overview: { gamesPlayed: 0, completedGames: 0, roundsPlayed: 0, votesCast: 0, videosArchived: 0, highestScore: 0 },
    players: [], recentVideos: [], videoCreators: [], rooms: []
});

export interface SqlStatement { text: string; values?: unknown[] }
export interface DatabaseDriver {
    query<T>(statement: SqlStatement): Promise<T[]>;
    transaction(statements: SqlStatement[]): Promise<void>;
}
