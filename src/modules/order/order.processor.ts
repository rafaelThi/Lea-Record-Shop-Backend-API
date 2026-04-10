import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { Order, OrderStatus } from './entities/order.entity';
import { Disc } from '../disc/entities/disc.entity';

interface ProcessOrderData {
  orderId: string;
  items: { discId: string; quantity: number }[];
}

@Processor('orders')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<ProcessOrderData>): Promise<void> {
    const { orderId, items } = job.data;

    this.logger.log(`Processing order ${orderId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      for (const item of items) {
        const disc = await queryRunner.manager
          .createQueryBuilder(Disc, 'disc')
          .setLock('pessimistic_write')
          .where('disc.id = :id', { id: item.discId })
          .getOne();

        if (!disc || disc.quantity < item.quantity) {
          await queryRunner.rollbackTransaction();
          await this.failOrder(orderId, 'Insufficient stock in database');

          await this.restoreRedisStock(item.discId, item.quantity);
          return;
        }

        const updateResult = await queryRunner.manager
          .createQueryBuilder()
          .update(Disc)
          .set({ quantity: () => `quantity - ${item.quantity}` })
          .where('id = :id AND quantity >= :qty', {
            id: item.discId,
            qty: item.quantity,
          })
          .execute();

        if (updateResult.affected === 0) {
          await queryRunner.rollbackTransaction();
          await this.failOrder(orderId, 'Stock update failed');
          await this.restoreRedisStock(item.discId, item.quantity);
          return;
        }
      }

      await queryRunner.manager.update(Order, orderId, {
        status: OrderStatus.CONFIRMED,
      });

      await queryRunner.commitTransaction();
      this.logger.log(`Order ${orderId} confirmed successfully`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Order ${orderId} processing failed`, error);

      for (const item of items) {
        await this.restoreRedisStock(item.discId, item.quantity);
      }

      await this.failOrder(orderId, error.message);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async failOrder(orderId: string, reason: string): Promise<void> {
    this.logger.warn(`Order ${orderId} failed: ${reason}`);
    await this.orderRepository.update(orderId, {
      status: OrderStatus.FAILED,
    });
  }

  private async restoreRedisStock(
    discId: string,
    quantity: number,
  ): Promise<void> {
    try {
      await this.redis.incrby(`stock:disc:${discId}`, quantity);
    } catch {
      this.logger.error(
        `Failed to restore Redis stock for disc ${discId}`,
      );
    }
  }
}
