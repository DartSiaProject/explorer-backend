import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('sync_state')
export class SyncState {
    @PrimaryColumn()
    key: string; // e.g., 'block_ingestion', 'host_scanning'

    @Column({ type: 'int', nullable: true })
    lastHeight: number;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;
}
