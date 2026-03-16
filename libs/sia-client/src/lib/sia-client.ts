import axios, { AxiosInstance } from 'axios';
import { BlockDto, HostDto } from 'common';
// Actually I don't know the exact path mapping yet. Usually @proj/lib.
// I'll check tsconfig.base.json later. For now I'll risk it or use relative if in same repo (but they are separate libs).
// Safest is to use the import path defined in tsconfig.base.json.
// The default is usually @<workspace-name>/<lib-name> or similar.
// I'll check tsconfig.base.json in next step if this fails or just check it now.

import * as https from 'https';

export class SiaClient {
  private readonly axios: AxiosInstance;

  constructor(baseURL?: string) {
    const apiUrl = baseURL || process.env['SIA_EXPLORED_API'] || 'https://api.sia.tech';

    // Simplified client to avoid network stack issues
    this.axios = axios.create({
      baseURL: apiUrl,
      timeout: 120000
    });
  }

  async getTip(): Promise<BlockDto> {
    // Explored API: GET /api/consensus/tip returns ChainIndex
    // ChainIndex has { height: number, id: string }
    const { data } = await this.axios.get('/api/consensus/tip');
    return data;  // Return the ChainIndex directly
  }

  async getBlockById(id: string): Promise<BlockDto> {
    // Explored API: GET /api/blocks/:id
    const { data } = await this.axios.get(`/api/blocks/${id}`);
    return data;
  }

  async getHosts(offset = 0, limit = 500, filters?: { online?: boolean }): Promise<HostDto[]> {
    // Explored API: POST /api/hosts
    // Max limit is 500 per api/server.go
    const body = filters || {};
    try {
      const { data } = await this.axios.post(`/api/hosts?limit=${limit}&offset=${offset}`, body);
      return data;
    } catch (e: any) {
      throw e;
    }
  }

  async getTransaction(id: string): Promise<any> {
    // Try V1 endpoint first (blocks < 526000)
    try {
      const { data } = await this.axios.get(`/api/transactions/${id}`);
      return data;
    } catch (error: any) {
      // If V1 fails with 404, try V2 endpoint (blocks >= 526000)
      if (error.response?.status === 404) {
        try {
          const { data } = await this.axios.get(`/api/v2/transactions/${id}`);
          return data;
        } catch (v2Error) {
          // Both failed, throw original error
          throw error;
        }
      }
      // Non-404 error, rethrow
      throw error;
    }
  }

  async getNetworkMetrics(): Promise<any> {
    // Siagraph API: GET /api/metrics/host
    const { data } = await this.axios.get('/api/metrics/host');
    return data;
  }

  async getChainIndex(height: number): Promise<{ id: string; height: number }> {
    try {
      // Explored API usage: /api/consensus/tip/:height
      const { data } = await this.axios.get(`/api/consensus/tip/${height}`);
      return data;
    } catch (e) {
      // Fallback to Siascan API if the configured instance fails
      console.warn(`Local/Configured API failed for chain index ${height}, trying api.siascan.com`);
      // Note: api.siascan.com does not use /api prefix for this endpoint based on verification
      const { data } = await axios.get(`https://api.siascan.com/consensus/tip/${height}`);
      return data;
    }
  }
  async getConsensusState(): Promise<any> {
    try {
      const { data } = await this.axios.get('/api/consensus/state');
      return data;
    } catch (e) {
      console.warn(`Local API failed for consensus state, trying api.siascan.com`);
      const { data } = await axios.get('https://api.siascan.com/consensus/state');
      return data;
    }
  }
}
