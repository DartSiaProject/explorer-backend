import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('hosts')
export class Host {
    @PrimaryColumn()
    publicKey: string;

    @Column({ nullable: true })
    netAddress: string;

    @Column({ type: 'timestamptz', nullable: true })
    firstSeen: Date;

    @Column({ type: 'timestamptz', nullable: true })
    lastSeen: Date;

    @Column({ type: 'jsonb', nullable: true })
    settings: any;

    @Column({ type: 'jsonb', nullable: true })
    v2Settings: any;

    @Column({ type: 'char', length: 2, nullable: true })
    countryCode: string;

    @Column({ type: 'numeric', nullable: true })
    score: number;

    @Column({ type: 'timestamptz', nullable: true })
    scoreUpdatedAt: Date;

    @Column({ type: 'varchar', nullable: true })
    totalUptime: string;

    @Column({ type: 'varchar', nullable: true })
    uptimeHours: string;
}
