import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';
import { DiscStyle } from '../enums/disc-style.enum';

@Entity('discs')
@Check('"quantity" >= 0')
export class Disc {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  artist: string;

  @Column({ name: 'release_year', type: 'smallint' })
  releaseYear: number;

  @Column({ type: 'varchar', length: 50 })
  style: DiscStyle;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
