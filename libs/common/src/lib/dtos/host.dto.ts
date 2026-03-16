export interface HostDto {
    publicKey: string;
    netAddress: string;
    firstSeen: string;
    lastSeen: string;
    generatedId: string;
    settings?: any;
    v2Settings?: any;
    priceTable?: any;
    scanned?: boolean;
}
