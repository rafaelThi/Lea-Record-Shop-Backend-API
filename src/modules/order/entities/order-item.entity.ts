import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { Order } from './order.entity';
import { Disc } from '../../disc/entities/disc.entity';

@Entity('order_items')
@Check('"quantity" > 0')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'disc_id', type: 'uuid' })
  discId: string;

  @ManyToOne(() => Disc, { eager: true })
  @JoinColumn({ name: 'disc_id' })
  disc: Disc;

  @Column({ type: 'int' })
  quantity: number;
}
