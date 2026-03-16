import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('blocks')
export class Block {
    @PrimaryColumn()
    height: number;

    @Column({ unique: true })
    id: string;

    @Column({ type: 'timestamptz' })
    @Index()
    timestamp: Date;

    @Column({ type: 'int', default: 0 })
    transactionCount: number;

    @Column({ type: 'jsonb', nullable: true })
    minerPayouts: any;

    @Column({ type: 'jsonb', nullable: true })
    transactions: any[];
}
