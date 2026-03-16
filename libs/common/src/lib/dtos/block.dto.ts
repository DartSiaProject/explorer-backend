export interface BlockDto {
  height: number;
  id: string;
  timestamp: string;
  previousBlockId: string;
  difficulty: string;
  totalCoins: string;
  transactionCount: number;
  minerPayouts?: any[];
  parentID?: string;
  transactions?: any[];
  transactionsCount?: number;
  v2?: {
    transactions?: any[];
    [key: string]: any;
  };
  fees?: number;
  miner?: string;
  size?: number;
}

export interface BlockStatsDto {
  height: number;
  difficulty: string;
  averageBlockTime: number; // in seconds
  averageBlockFees: number; // in SC
  hashrate: number; // in H/s
}
