import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Host } from './host.entity';

@Entity('host_metrics')
export class HostMetric {
    @PrimaryColumn({ type: 'timestamptz' })
    time: Date;

    @PrimaryColumn()
    hostPublicKey: string;

    @ManyToOne(() => Host)
    @JoinColumn({ name: 'hostPublicKey' })
    host: Host;

    @Column({ type: 'numeric', nullable: true })
    storagePrice: number;

    @Column({ type: 'numeric', nullable: true })
    uploadPrice: number;

    @Column({ type: 'numeric', nullable: true })
    downloadPrice: number;

    @Column({ type: 'bigint', nullable: true })
    remainingStorage: string;

    @Column({ type: 'bigint', nullable: true })
    uptimeTotal: string;

    @Column({ type: 'bigint', nullable: true })
    uptimeH: string;
}
